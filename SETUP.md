# Setup Guide

## Environment Configuration

This project requires environment files that are not tracked in git for security reasons.

### Development Setup

1. **Create environment file:**
   ```bash
   cp .env.example .env.dev
   ```

2. **Create docker compose override (optional):**
   ```bash
   cp compose.override.yaml.example compose.override.yaml
   ```

3. **Edit `.env.dev`** with your local development settings

4. **Run development environment:**
   ```bash
   docker compose up -d
   ```

### Production Setup

1. **Create production environment file:**
   ```bash
   cp .env.example .env.prod
   ```

2. **Create production compose file:**
   ```bash
   cp compose.prod.yaml.example compose.prod.yaml
   ```

3. **Edit `.env.prod`** with your production settings:
   - Set `DOMAIN` to your actual domain
   - Configure API settings
   - Add any secrets (database passwords, API keys, etc.)

4. **Edit `compose.prod.yaml`** with production-specific configuration:
   - SSL/TLS settings
   - Resource limits
   - Restart policies
   - Production environment variables

5. **Run production environment:**
   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml up -d --build
   ```

## Security Notes

- **Never commit** `.env.dev`, `.env.prod`, `compose.override.yaml`, or `compose.prod.yaml` to git
- These files are already in `.gitignore`
- Use environment variables or secrets management for sensitive data
- For production, consider using Docker secrets or a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)

## Files Not Tracked in Git

The following files should be created locally but are **not** tracked in version control:

- `.env.dev` - Development environment variables
- `.env.prod` - Production environment variables
- `compose.override.yaml` - Local Docker Compose overrides
- `compose.prod.yaml` - Production Docker Compose configuration

Template files ending in `.example` are provided for reference.
