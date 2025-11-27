.PHONY: dev-frontend dev-backend dev install

install:
	cd frontend && npm install
	cd backend && go mod download

dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && go run cmd/api/main.go

dev:
	make -j2 dev-frontend dev-backend