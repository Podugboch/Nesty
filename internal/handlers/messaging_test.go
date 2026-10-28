package handlers

import (
	"testing"

	"piscine-devnest/internal/ai"
	"piscine-devnest/internal/model"
)

func TestValidationRules(t *testing.T) {
	h := &Handler{}

	// Test validateEmail
	if !h.validateEmail("dev@nesty.app") {
		t.Errorf("expected valid email")
	}
	if h.validateEmail("invalid-email") {
		t.Errorf("expected invalid email")
	}

	// Test validatePassword
	if !h.validatePassword("secret123") {
		t.Errorf("expected password length >= 6 to pass")
	}
	if h.validatePassword("123") {
		t.Errorf("expected short password to fail")
	}

	// Test validateUsername
	if !h.validateUsername("nester") {
		t.Errorf("expected valid username")
	}
	if h.validateUsername("ab") {
		t.Errorf("expected short username to fail")
	}
}

func TestAIModerationFilter(t *testing.T) {
	svc := ai.NewService()

	// Clean content
	res, err := svc.ModerateContent("Hey everyone, let's collaborate on the Go backend!")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.IsAppropriate {
		t.Errorf("expected friendly content to be approved")
	}

	// Flagged content
	resBad, err := svc.ModerateContent("I will threaten and doxx you")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resBad.IsAppropriate {
		t.Errorf("expected harmful content to be flagged")
	}
}

func TestAIDiscussionSummary(t *testing.T) {
	svc := ai.NewService()

	messages := []string{
		"Hey team, how do we handle WebRTC NAT traversal?",
		"We should use Google STUN servers and Coturn for TURN relay.",
		"Agreed! I will configure the TURN relay credentials in the environment.",
	}

	summary, err := svc.SummarizeDiscussion(messages, "WebRTC Calling Architecture")
	if err != nil {
		t.Fatalf("summarize failed: %v", err)
	}
	if summary.MessageCount != 3 {
		t.Errorf("expected message count 3, got %d", summary.MessageCount)
	}
	if len(summary.KeyPoints) == 0 {
		t.Errorf("expected key points to be generated")
	}
}

func TestMessageQuotingModel(t *testing.T) {
	quoted := model.QuotedMessage{
		ID:         1,
		SenderID:   2,
		Username:   "alex",
		SenderName: "Alex Doe",
		Content:    "Hello Nesty!",
		IsDeleted:  false,
	}

	if quoted.SenderName != "Alex Doe" || quoted.IsDeleted {
		t.Errorf("unexpected quoted message state")
	}
}
