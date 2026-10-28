package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
	"piscine-devnest/internal/model"
)

type RecommendedUser struct {
	User          model.User `json:"user"`
	MatchScore    int        `json:"match_score"` // 0-100%
	SharedSkills  []string   `json:"shared_skills"`
	MatchReason   string     `json:"match_reason"`
}

type RecommendedCommunity struct {
	Community   model.Community `json:"community"`
	MatchScore  int             `json:"match_score"`
	MatchReason string          `json:"match_reason"`
}

type RecommendationResult struct {
	People      []RecommendedUser      `json:"people"`
	Communities []RecommendedCommunity `json:"communities"`
}

type SummaryResult struct {
	Topic       string   `json:"topic"`
	Summary     string   `json:"summary"`
	KeyPoints   []string `json:"key_points"`
	MessageCount int     `json:"message_count"`
}

type ModerationResult struct {
	IsAppropriate bool     `json:"is_appropriate"`
	Flags         []string `json:"flags,omitempty"`
	Confidence    float64  `json:"confidence"`
	Reason        string   `json:"reason,omitempty"`
}

type Service struct {
	apiKey     string
	httpClient *http.Client
}

func NewService() *Service {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		key = os.Getenv("AI_API_KEY")
	}
	return &Service{
		apiKey: key,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// GetRecommendations computes intelligent person & community discovery based on interests, skills and activity
func (s *Service) GetRecommendations(db *gorm.DB, currentUserID uint) (*RecommendationResult, error) {
	var currentUser model.User
	if err := db.First(&currentUser, currentUserID).Error; err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Fetch all active users except current
	var allUsers []model.User
	if err := db.Where("id != ? AND status = 'active'", currentUserID).Limit(100).Find(&allUsers).Error; err != nil {
		return nil, err
	}

	// Parse current user skills & keywords
	currTokens := extractKeywords(currentUser.Skills + " " + currentUser.Bio + " " + currentUser.Batch + " " + currentUser.Location)

	var peopleRecs []RecommendedUser
	for _, u := range allUsers {
		targetTokens := extractKeywords(u.Skills + " " + u.Bio + " " + u.Batch + " " + u.Location)
		shared := findIntersection(currTokens, targetTokens)
		
		score := 35 // Base discovery score
		score += len(shared) * 15
		if currentUser.Batch != "" && currentUser.Batch == u.Batch {
			score += 20
		}
		if currentUser.Location != "" && strings.EqualFold(currentUser.Location, u.Location) {
			score += 15
		}
		if score > 98 {
			score = 98
		}

		reason := "Discovered through mutual interests"
		if len(shared) > 0 {
			reason = fmt.Sprintf("Shares skills in %s", strings.Join(shared[:min(len(shared), 3)], ", "))
		} else if currentUser.Batch != "" && currentUser.Batch == u.Batch {
			reason = fmt.Sprintf("Same batch (%s)", u.Batch)
		}

		peopleRecs = append(peopleRecs, RecommendedUser{
			User:         u,
			MatchScore:   score,
			SharedSkills: shared,
			MatchReason:  reason,
		})
	}

	// Sort people by match score descending
	for i := 0; i < len(peopleRecs); i++ {
		for j := i + 1; j < len(peopleRecs); j++ {
			if peopleRecs[i].MatchScore < peopleRecs[j].MatchScore {
				peopleRecs[i], peopleRecs[j] = peopleRecs[j], peopleRecs[i]
			}
		}
	}
	if len(peopleRecs) > 10 {
		peopleRecs = peopleRecs[:10]
	}

	// Recommended communities
	var communities []model.Community
	if err := db.Limit(50).Find(&communities).Error; err == nil {
		// Get communities user already belongs to
		var myMemberships []model.CommunityMember
		_ = db.Where("user_id = ?", currentUserID).Find(&myMemberships)
		myCommMap := make(map[uint]bool)
		for _, m := range myMemberships {
			myCommMap[m.CommunityID] = true
		}

		var commRecs []RecommendedCommunity
		for _, c := range communities {
			if myCommMap[c.ID] {
				continue
			}
			commTokens := extractKeywords(c.Name + " " + c.Description)
			shared := findIntersection(currTokens, commTokens)
			score := 40 + len(shared)*20
			if score > 99 {
				score = 99
			}

			reason := "Trending community"
			if len(shared) > 0 {
				reason = fmt.Sprintf("Matches your focus: %s", strings.Join(shared[:min(len(shared), 2)], ", "))
			}

			commRecs = append(commRecs, RecommendedCommunity{
				Community:   c,
				MatchScore:  score,
				MatchReason: reason,
			})
		}

		// Sort communities
		for i := 0; i < len(commRecs); i++ {
			for j := i + 1; j < len(commRecs); j++ {
				if commRecs[i].MatchScore < commRecs[j].MatchScore {
					commRecs[i], commRecs[j] = commRecs[j], commRecs[i]
				}
			}
		}
		if len(commRecs) > 6 {
			commRecs = commRecs[:6]
		}

		return &RecommendationResult{
			People:      peopleRecs,
			Communities: commRecs,
		}, nil
	}

	return &RecommendationResult{
		People:      peopleRecs,
		Communities: []RecommendedCommunity{},
	}, nil
}

// SummarizeDiscussion produces a structured summary with key takeaways
func (s *Service) SummarizeDiscussion(messages []string, topic string) (*SummaryResult, error) {
	if len(messages) == 0 {
		return &SummaryResult{
			Topic:        topic,
			Summary:      "No discussion messages to summarize yet.",
			KeyPoints:    []string{},
			MessageCount: 0,
		}, nil
	}

	cleanTopic := strings.TrimSpace(topic)
	if cleanTopic == "" {
		cleanTopic = "Channel Discussion"
	}

	// Try remote Gemini call if API key configured
	if s.apiKey != "" {
		if res, err := s.callGeminiSummary(messages, cleanTopic); err == nil && res != nil {
			return res, nil
		}
	}

	// Heuristic algorithmic summary
	keyPoints := make([]string, 0)
	var sb strings.Builder

	for _, m := range messages {
		trimmed := strings.TrimSpace(m)
		if len(trimmed) > 20 && len(keyPoints) < 5 {
			// Extract actionable or informative messages
			if strings.Contains(trimmed, "?") || strings.Contains(trimmed, "http") || len(trimmed) > 40 {
				keyPoints = append(keyPoints, trimmed)
			}
		}
	}

	if len(keyPoints) == 0 && len(messages) > 0 {
		keyPoints = append(keyPoints, messages[0])
		if len(messages) > 1 {
			keyPoints = append(keyPoints, messages[len(messages)-1])
		}
	}

	sb.WriteString(fmt.Sprintf("Discussion covering %d contributions regarding %s. Key exchanges centered on collaborative problem solving and progress updates.", len(messages), cleanTopic))

	return &SummaryResult{
		Topic:        cleanTopic,
		Summary:      sb.String(),
		KeyPoints:    keyPoints,
		MessageCount: len(messages),
	}, nil
}

func (s *Service) callGeminiSummary(messages []string, topic string) (*SummaryResult, error) {
	prompt := fmt.Sprintf("Summarize the following %s chat discussion in 2 concise sentences, followed by 3-4 bullet points of key takeaways:\n\n%s",
		topic, strings.Join(messages, "\n"))

	payload := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{"text": prompt},
				},
			},
		},
	}

	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=%s", s.apiKey)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("gemini api error (%d): %s", resp.StatusCode, string(b))
	}

	var res struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}

	if len(res.Candidates) > 0 && len(res.Candidates[0].Content.Parts) > 0 {
		outText := res.Candidates[0].Content.Parts[0].Text
		lines := strings.Split(outText, "\n")
		var keyPoints []string
		var summaryLines []string
		for _, l := range lines {
			trimmed := strings.TrimSpace(l)
			if strings.HasPrefix(trimmed, "*") || strings.HasPrefix(trimmed, "-") {
				keyPoints = append(keyPoints, strings.TrimSpace(strings.TrimLeft(trimmed, "*- ")))
			} else if trimmed != "" {
				summaryLines = append(summaryLines, trimmed)
			}
		}
		return &SummaryResult{
			Topic:        topic,
			Summary:      strings.Join(summaryLines, " "),
			KeyPoints:    keyPoints,
			MessageCount: len(messages),
		}, nil
	}

	return nil, fmt.Errorf("no response candidate")
}

// ModerateContent reviews text for inappropriate material
func (s *Service) ModerateContent(content string) (*ModerationResult, error) {
	lower := strings.ToLower(content)
	bannedKeywords := []string{"kill yourself", "kys", "hate speech", "terrorist", "threaten", "doxx"}
	var flags []string
	for _, kw := range bannedKeywords {
		if strings.Contains(lower, kw) {
			flags = append(flags, kw)
		}
	}

	if len(flags) > 0 {
		return &ModerationResult{
			IsAppropriate: false,
			Flags:         flags,
			Confidence:    0.95,
			Reason:        fmt.Sprintf("Matched safety filter: %s", strings.Join(flags, ", ")),
		}, nil
	}

	return &ModerationResult{
		IsAppropriate: true,
		Confidence:    0.99,
	}, nil
}

func extractKeywords(text string) []string {
	clean := strings.ToLower(text)
	replacer := strings.NewReplacer(",", " ", ";", " ", "/", " ", ".", " ", "\n", " ", "|", " ")
	clean = replacer.Replace(clean)
	words := strings.Fields(clean)
	stopWords := map[string]bool{
		"and": true, "the": true, "with": true, "for": true, "in": true, "at": true, "of": true,
		"to": true, "a": true, "an": true, "is": true, "on": true, "from": true, "by": true, "i": true,
	}

	set := make(map[string]bool)
	for _, w := range words {
		w = strings.Trim(w, "!?:'\"()")
		if len(w) > 2 && !stopWords[w] {
			set[w] = true
		}
	}
	var res []string
	for k := range set {
		res = append(res, k)
	}
	return res
}

func findIntersection(a, b []string) []string {
	set := make(map[string]bool)
	for _, x := range a {
		set[x] = true
	}
	var common []string
	for _, y := range b {
		if set[y] {
			common = append(common, y)
		}
	}
	return common
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
