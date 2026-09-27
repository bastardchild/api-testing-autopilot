// examples/demo-api-go/handlers.go
package main

import (
	"encoding/json"
	"net/http"
)

// healthHandler uses switch r.Method — demonstrates method inference.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func listUsers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []map[string]any{
		{"id": 1, "name": "Alice"},
		{"id": 2, "name": "Bob"},
	})
}

func createUser(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	body["id"] = 3
	writeJSON(w, http.StatusCreated, body)
}

func getUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": "Alice"})
}

func updateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	body["id"] = id
	writeJSON(w, http.StatusOK, body)
}

func deleteUser(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func listProducts(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []map[string]any{
		{"id": 1, "name": "Widget", "price": 9.99},
	})
}

func getProduct(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": "Widget", "price": 9.99})
}

func createProduct(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	body["id"] = 2
	writeJSON(w, http.StatusCreated, body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
