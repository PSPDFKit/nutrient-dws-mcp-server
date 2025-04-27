# Contributing to Nutrient DWS MCP Server

We welcome contributions to the Nutrient DWS MCP Server! This document outlines the process for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/PSPDFKit/nutrient-dws-mcp-server.git`
3. Install dependencies: `pnpm install`
4. Build the project: `pnpm run build`
5. Run tests: `pnpm test`

## Development Process

1. Create a new branch for your changes
2. Make your changes
3. Run `pnpm run lint` to ensure code style compliance
4. Run `pnpm run format` to format the code.
5. Run `pnpm test` to verify all tests pass
6. Submit a pull request

## Pull Request Guidelines

- Follow the existing code style
- Include tests for new functionality
- Update documentation as needed
- Keep changes focused and atomic
- Provide a clear description of changes

## Testing

The project uses [Vitest](https://vitest.dev/) as the test framework. The test suite includes:

- Unit tests for API calls and file-based operations (high-level concepts such as networking and the file system are mocked)
- End-to-end DWS API tests to ensure a message format is adhered to

To run the tests:

1. Copy the `.env.example` to `.env` and add your [Nutrient DWS API key](https://dashboard.nutrient.io/sign_up/).
2. Install the dependencies and run the tests:

```bash
pnpm install
pnpm test
```

## Running the Server Locally

To run the server locally:

```bash
# With sandbox mode (recommended)
npx . --sandbox /path/to/sandbox/directory

# Without sandbox mode (not recommended)
npx .
```

## Reporting Issues

- Use the [GitHub issue tracker](https://github.com/PSPDFKit/nutrient-dws-mcp-server/issues)
- Search existing issues before creating a new one
- Provide clear reproduction steps

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
