// examples/demo-api-go/main.go
// stdlib net/http demo API — zero external dependencies.
// Demonstrates: Go 1.22 pattern strings, legacy HandleFunc with method inference,
// nested route groups via helper, const resolution.
package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()

	// Go 1.22 pattern strings — method is first token
	mux.HandleFunc("GET /api/v1/users", listUsers)
	mux.HandleFunc("POST /api/v1/users", createUser)
	mux.HandleFunc("GET /api/v1/users/{id}", getUser)
	mux.HandleFunc("PUT /api/v1/users/{id}", updateUser)
	mux.HandleFunc("DELETE /api/v1/users/{id}", deleteUser)

	// Legacy HandleFunc — no method in pattern; handler uses switch r.Method
	mux.HandleFunc("/api/v1/health", healthHandler)

	// Nested group helper — exercises prefix tracking
	registerProductRoutes(mux)

	fmt.Println("demo-api-go running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

// registerProductRoutes registers product endpoints under /api/v1/products.
// Demonstrates nested route group prefix tracking.
func registerProductRoutes(mux *http.ServeMux) {
	const base = "/api/v1/products"

	mux.HandleFunc("GET "+base, listProducts)
	mux.HandleFunc("GET "+base+"/{id}", getProduct)
	mux.HandleFunc("POST "+base, createProduct)
}
