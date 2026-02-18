# OpenAPI Auto-Validator

A powerful CLI tool to validate OpenAPI/Swagger specifications and live API responses.

## Features

- ✅ Validate OpenAPI 2.0 (Swagger) and OpenAPI 3.x specifications
- ✅ Support for both YAML and JSON spec files
- ✅ Validate live API responses against the spec
- ✅ Human-friendly colored output
- ✅ Proper exit codes for CI/CD integration
- ✅ Detailed error reporting

## Installation

### From npm (global)

```bash
npm install -g openapi-auto-validator
```

### From source

```bash
# Clone the repository
git clone https://github.com/your-username/openapi-auto-validator.git
cd openapi-auto-validator

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

## Usage

### Validate an OpenAPI Specification

Validate the structure and syntax of an OpenAPI/Swagger file:

```bash
openapi-auto-validator validate-spec <path-to-spec>

# Examples
openapi-auto-validator validate-spec ./api/openapi.yaml
openapi-auto-validator validate-spec ./api/swagger.json
```

**Options:**
- `--strict` - Enable strict validation mode

### Validate Live API Responses

Send requests to a live API and validate responses against the spec:

```bash
openapi-auto-validator validate-api <path-to-spec> --url <base-url>

# Examples
openapi-auto-validator validate-api ./api/openapi.yaml --url https://api.example.com
openapi-auto-validator validate-api ./api/openapi.yaml --url http://localhost:3000 --endpoints "/users,/products"
```

**Options:**
- `-u, --url <baseUrl>` - Base URL of the API to validate (required)
- `-e, --endpoints <paths>` - Comma-separated list of endpoints to test (optional, tests all by default)
- `-H, --header <headers>` - Custom headers in format "Key:Value" (can be used multiple times)
- `--timeout <ms>` - Request timeout in milliseconds (default: 5000)

### Global Options

- `-V, --version` - Output the version number
- `-h, --help` - Display help for command

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Validation passed |
| 1 | Validation failed |
| 2 | File not found or unreadable |
| 3 | Invalid command or options |

## Examples

### Basic Spec Validation

```bash
$ openapi-auto-validator validate-spec ./petstore.yaml

✓ OpenAPI specification is valid!

  Title: Swagger Petstore
  Version: 1.0.0
  OpenAPI Version: 3.0.3
  Paths: 15
  Schemas: 8
```

### Live API Validation

```bash
$ openapi-auto-validator validate-api ./petstore.yaml --url https://petstore.swagger.io/v2

Validating API at https://petstore.swagger.io/v2...

✓ GET /pet/findByStatus - 200 OK (125ms)
✓ GET /pet/{petId} - 200 OK (98ms)
✗ POST /pet - Response validation failed
  └─ Response body does not match schema: "name" is required

Results: 2 passed, 1 failed
```

## Development

### Project Structure

```
openapi-auto-validator/
├── src/
│   ├── index.ts          # Entry point
│   ├── cli/
│   │   ├── index.ts      # CLI setup
│   │   └── commands/     # Command implementations
│   ├── validators/       # Validation logic
│   └── utils/            # Utilities (loader, logger, types)
├── tests/                # Test files
├── package.json
├── tsconfig.json
└── README.md
```

### Scripts

```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm run test       # Run tests
npm run test:watch # Watch tests
npm run lint       # Lint code
npm run clean      # Clean dist folder
```

### Running Tests

```bash
npm test
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request