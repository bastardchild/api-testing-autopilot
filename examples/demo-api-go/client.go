// examples/demo-api-go/client.go
// Demonstrates http.NewRequest + client.Do client-call extraction
// and const base URL resolution.
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
)

const apiBase = "http://localhost:8080"

type apiClient struct {
	http *http.Client
}

func newAPIClient() *apiClient {
	return &apiClient{http: &http.Client{}}
}

func (c *apiClient) getUsers() (*http.Response, error) {
	req, _ := http.NewRequest(http.MethodGet, apiBase+"/api/v1/users", nil)
	return c.http.Do(req)
}

func (c *apiClient) getUser(id string) (*http.Response, error) {
	req, _ := http.NewRequest(http.MethodGet, apiBase+"/api/v1/users/"+id, nil)
	return c.http.Do(req)
}

func (c *apiClient) createUser(body map[string]any) (*http.Response, error) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, apiBase+"/api/v1/users", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	return c.http.Do(req)
}
