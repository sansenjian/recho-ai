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

	// Initialize libvips when CGO is available
	initVips()
	defer shutdownVips()

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
	var idempotencyRepo *repository.IdempotencyRepository
	if db != nil {
		creditRepo = repository.NewCreditRepository(db.Pool())
		redeemRepo = repository.NewRedeemRepository(db.Pool())
		idempotencyRepo = repository.NewIdempotencyRepository(db.Pool())
	}

	// Initialize services
	var creditService *service.CreditService
	var redeemService *service.RedeemService
	var idempotencyService *service.IdempotencyService
	var appSettingsService *service.AppSettingsService
	if creditRepo != nil {
		creditService = service.NewCreditService(creditRepo)
		redeemService = service.NewRedeemService(redeemRepo)
	}
	if idempotencyRepo != nil {
		idempotencyService = service.NewIdempotencyService(idempotencyRepo)
	}
	if db != nil {
		appSettingsService = service.NewAppSettingsService(db.Pool())
	}

	// Initialize image processor and S3 uploader
	imageProcessor := service.NewImageProcessor()
	s3Uploader := service.S3UploaderFromEnv()

	// Initialize storage service
	var storageService *service.StorageService
	if db != nil {
		storageService = service.NewStorageService(db.Pool(), imageProcessor, s3Uploader)
	}

	// Initialize chat service. Chat remains optional while Go is used as an image sidecar.
	chatService := service.NewChatService(config.ChatBaseURL, config.ChatAPIKey, config.AnalysisURL)

	// Initialize handlers
	healthHandler := handler.NewHealthHandler(db)
	var configHandler *handler.ConfigHandler
	if appSettingsService != nil {
		configHandler = handler.NewConfigHandler(appSettingsService, log.Default())
	} else {
		configHandler = handler.NewConfigHandler(nil, log.Default())
	}
	creditsHandler := handler.NewCreditsHandler(creditService, redeemService, idempotencyService)
	imageHandler := handler.NewImageHandler(creditService, storageService, idempotencyService)
	chatHandler := handler.NewChatHandler(chatService, creditService, config.AnalysisURL)

	// Setup router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)
	r.Use(chiMiddleware.RequestID)

	// CORS middleware
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   config.CorsOrigins(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key", "X-Reference-ID", "X-Reference-Title", "X-Reference-Filename"},
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
		// Parse Supabase auth when present. Individual handlers still decide
		// whether the endpoint requires a signed-in user.
		r.Use(middleware.AuthMiddleware)

		// Public config endpoints
		configHandler.RegisterRoutes(r)

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
		Addr:              fmt.Sprintf(":%d", config.Port),
		Handler:           r,
		ReadTimeout:       120 * time.Second,
		WriteTimeout:      620 * time.Second,
		IdleTimeout:       120 * time.Second,
		ReadHeaderTimeout: 10 * time.Second, // mitigates Slowloris attacks
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