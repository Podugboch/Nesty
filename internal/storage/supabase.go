package storage

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// UploadToSupabase uploads a file's bytes to the given bucket/path in Supabase Storage
// and returns the public URL for that file.
func UploadToSupabase(bucket string, path string, data []byte, contentType string) (string, error) {
	supabaseURL := os.Getenv("SUPABASE_URL")
	serviceKey := os.Getenv("SUPABASE_SERVICE_KEY")

	if supabaseURL == "" || serviceKey == "" {
		return "", fmt.Errorf("missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")
	}

	uploadURL := fmt.Sprintf("%s/storage/v1/object/%s/%s", supabaseURL, bucket, path)

	req, err := http.NewRequest(http.MethodPost, uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", err
	}

	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", contentType)

	client := &http.Client{
		Timeout: 3 * time.Minute,
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("supabase connection error: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("supabase upload failed (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	publicURL := fmt.Sprintf("%s/storage/v1/object/public/%s/%s", supabaseURL, bucket, path)
	return publicURL, nil
}