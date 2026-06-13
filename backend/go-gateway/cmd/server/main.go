package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"

	"go-gateway/internal/config"
	"go-gateway/internal/handler"
	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/supabase"
	"go-gateway/internal/repository"
	"go-gateway/internal/service"
)

func main() {
	// Load .env file if present
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize middleware (JWT secret, production safety checks)
	middleware.Init()

	// Initialize Supabase client
	var db *supabase.Client
	var err error
	if config.SupabaseURL != "" && config.SupabaseServiceRoleKey != "" {
		db, err = supabase.NewClient()
		if err != nil {
			log.Printf("Warning: Failed to initialize Supabase client: %v", err)
			log.Println("Continuing without database connection...")
		} else {
			log.Println("Supabase client initialized successfully")
			defer db.Close()
		}
	} else {
		log.Println("Supabase credentials not configured, running in limited mode")
	}

	// Initialize repositories
	var creditRepo *repository.CreditRepository
	var redeemRepo *repository.RedeemRepository
	if db != nil {
		creditRepo = repository.NewCreditRepository(db.Pool())
		redeemRepo = repository.NewRedeemRepository(db)
	}

	// Initialize services
	var creditService *service.CreditService
	var redeemService *service.RedeemService
	if creditRepo != nil {
		creditService = service.NewCreditService(creditRepo)
		redeemService = service.NewRedeemService(redeemRepo, creditService)
	}

	// Initialize storage service
	var storageService *service.StorageService
	if db != nil {
		storageService = service.NewStorageService(db.Pool())
	}

	// Initialize chat service
	chatService := service.NewChatService(config.ImageGenBaseURL, os.Getenv("ANALYSIS_URL"))

	// Initialize handlers
	healthHandler := handler.NewHealthHandler(db)
	creditsHandler := handler.NewCreditsHandler(creditService, redeemService)
	imageHandler := handler.NewImageHandler(creditService, storageService)
	chatHandler := handler.NewChatHandler(chatService, creditService, os.Getenv("ANALYSIS_URL"))

	// Setup router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)
	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.Timeout(60 * time.Second))

	// CORS middleware
	corsOrigins := []string{}
	if config.CorsOrigin != "" {
		corsOrigins = append(corsOrigins, config.CorsOrigin)
	}
	if len(corsOrigins) == 0 {
		corsOrigins = append(corsOrigins, "http://localhost:5173")
	}

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check routes (no auth required)
	r.Route("/", func(r chi.Router) {
		healthHandler.RegisterRoutes(r)
	})

	// API routes with authentication
	r.Route("/api", func(r chi.Router) {
		// Apply auth middleware to all API routes
		r.Use(middleware.AuthMiddleware)

		// Credits endpoints
		creditsHandler.RegisterRoutes(r)

		// Image generation endpoints
		r.Route("/image", func(r chi.Router) {
			imageHandler.RegisterRoutes(r)
		})

		// Chat endpoints
		r.Route("/chat", func(r chi.Router) {
			r.Mount("/", chatHandler.Routes())
		})
	})

	// Create HTTP server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", config.Port),
		Handler:      r,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Printf("Starting Go Gateway on :%d", config.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited gracefully")
}
