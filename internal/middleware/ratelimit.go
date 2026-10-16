package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type clientBucket struct {
	count     int
	resetTime time.Time
}

type MemoryRateLimiter struct {
	mu       sync.Mutex
	clients  map[string]*clientBucket
	limit    int
	window   time.Duration
	stopChan chan struct{}
}

func NewMemoryRateLimiter(limit int, window time.Duration) *MemoryRateLimiter {
	limiter := &MemoryRateLimiter{
		clients:  make(map[string]*clientBucket),
		limit:    limit,
		window:   window,
		stopChan: make(chan struct{}),
	}

	// Periodically purge expired clients to prevent unbounded memory growth
	go func() {
		ticker := time.NewTicker(window * 2)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				limiter.mu.Lock()
				now := time.Now()
				for k, v := range limiter.clients {
					if now.After(v.resetTime) {
						delete(limiter.clients, k)
					}
				}
				limiter.mu.Unlock()
			case <-limiter.stopChan:
				return
			}
		}
	}()

	return limiter
}

func (l *MemoryRateLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	bucket, exists := l.clients[key]
	if !exists || now.After(bucket.resetTime) {
		l.clients[key] = &clientBucket{
			count:     1,
			resetTime: now.Add(l.window),
		}
		return true
	}

	if bucket.count < l.limit {
		bucket.count++
		return true
	}

	return false
}

// Global rate limiters
var (
	LoginLimiter  = NewMemoryRateLimiter(10, 1*time.Minute) // 10 login attempts per minute per IP
	AdminLimiter  = NewMemoryRateLimiter(60, 1*time.Minute) // 60 admin requests per minute per admin
	ReportLimiter = NewMemoryRateLimiter(5, 1*time.Minute)  // 5 reports per minute per user
)

// RateLimitLogin limits brute force on login endpoint by client IP
func RateLimitLogin() gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		if !LoginLimiter.Allow(clientIP) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many login attempts. Please wait a minute and try again.",
				"code":  "rate_limited",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// RateLimitAdmin limits request frequency on /api/admin/* routes
func RateLimitAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if userID, exists := c.Get("user_id"); exists {
			key = "admin_" + strconv.FormatUint(uint64(userID.(uint)), 10)
		}

		if !AdminLimiter.Allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Admin API rate limit exceeded. Please slow down.",
				"code":  "rate_limited",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// RateLimitReport limits normal users from spamming reports
func RateLimitReport() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if userID, exists := c.Get("user_id"); exists {
			key = "reporter_" + strconv.FormatUint(uint64(userID.(uint)), 10)
		}

		if !ReportLimiter.Allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "You are submitting reports too quickly. Please wait before submitting another report.",
				"code":  "rate_limited",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
