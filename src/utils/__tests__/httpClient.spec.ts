import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import * as fs from "fs"
import { createConfiguredAxiosInstance, getConfiguredAxiosConfig, clearCertificateCache } from "../httpClient"

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

// Mock fs
vi.mock("fs", () => ({
	readFileSync: vi.fn(),
}))

// Mock proxy-agent
vi.mock("proxy-agent", () => ({
	ProxyAgent: vi.fn().mockImplementation(() => ({
		// Mock proxy agent implementation
	})),
}))

describe("httpClient", () => {
	const mockGetConfiguration = vi.mocked(vscode.workspace.getConfiguration)
	const mockReadFileSync = vi.mocked(fs.readFileSync)

	beforeEach(() => {
		vi.clearAllMocks()
		// Clear environment variables
		delete process.env.HTTPS_PROXY
		delete process.env.https_proxy
		delete process.env.HTTP_PROXY
		delete process.env.http_proxy
		delete process.env.ALL_PROXY
		delete process.env.all_proxy
		delete process.env.NODE_EXTRA_CA_CERTS
		delete process.env.AWS_CA_BUNDLE
		// Clear the certificate cache
		clearCertificateCache()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("createConfiguredAxiosInstance", () => {
		it("should create axios instance with default configuration when no proxy is configured", () => {
			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(mockGetConfiguration).toHaveBeenCalledWith("http")
		})

		it("should create axios instance with proxy configuration when VS Code proxy is set", () => {
			// Mock VS Code configuration with proxy
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return "http://proxy.example.com:8080"
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(mockGetConfiguration).toHaveBeenCalledWith("http")
		})

		it("should create axios instance with proxy configuration when environment proxy is set", () => {
			// Set environment proxy
			process.env.HTTPS_PROXY = "http://proxy.example.com:8080"

			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(mockGetConfiguration).toHaveBeenCalledWith("http")
		})

		it("should handle custom CA certificates", () => {
			const mockCaContent = Buffer.from("mock-ca-content")
			const caPath = "/path/to/ca.crt"

			// Set CA environment variable
			process.env.NODE_EXTRA_CA_CERTS = caPath

			// Mock file reading
			mockReadFileSync.mockReturnValue(mockCaContent)

			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(mockReadFileSync).toHaveBeenCalledWith(caPath)
		})

		it("should handle CA certificate reading errors gracefully", () => {
			const caPath = "/path/to/nonexistent/ca.crt"

			// Set CA environment variable
			process.env.NODE_EXTRA_CA_CERTS = caPath

			// Mock file reading error
			mockReadFileSync.mockImplementation(() => {
				throw new Error("File not found")
			})

			// Mock console.warn to avoid test output
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(mockReadFileSync).toHaveBeenCalledWith(caPath)
			expect(consoleSpy).toHaveBeenCalledWith(
				"Failed to read custom CA bundle; continuing without it",
				expect.objectContaining({
					error: "File not found",
					caPath,
				}),
			)

			consoleSpy.mockRestore()
		})

		it("should merge provided configuration with proxy/CA configuration", () => {
			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const customConfig = {
				timeout: 5000,
				headers: {
					"Custom-Header": "value",
				},
			}

			const axiosInstance = createConfiguredAxiosInstance(customConfig)

			expect(axiosInstance).toBeDefined()
			// The axios instance should have the custom configuration merged
			expect(axiosInstance.defaults.timeout).toBe(5000)
			expect(axiosInstance.defaults.headers["Custom-Header"]).toBe("value")
		})

		it("should handle configuration errors gracefully and fall back to default axios", () => {
			// Mock VS Code configuration to throw an error
			mockGetConfiguration.mockImplementation(() => {
				throw new Error("Configuration error")
			})

			// Mock console.warn to avoid test output
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(consoleSpy).toHaveBeenCalledWith(
				"Failed to create configured axios instance; falling back to default axios",
				expect.objectContaining({
					error: "Configuration error",
				}),
			)

			consoleSpy.mockRestore()
		})

		it("should prefer AWS_CA_BUNDLE over NODE_EXTRA_CA_CERTS", () => {
			const mockCaContent = Buffer.from("mock-ca-content")
			const awsCaPath = "/path/to/aws-ca.crt"
			const nodeCaPath = "/path/to/node-ca.crt"

			// Set both CA environment variables
			process.env.NODE_EXTRA_CA_CERTS = nodeCaPath
			process.env.AWS_CA_BUNDLE = awsCaPath

			// Mock file reading
			mockReadFileSync.mockReturnValue(mockCaContent)

			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			// Should use AWS_CA_BUNDLE path, not NODE_EXTRA_CA_CERTS
			expect(mockReadFileSync).toHaveBeenCalledWith(awsCaPath)
			expect(mockReadFileSync).not.toHaveBeenCalledWith(nodeCaPath)
		})

		it("should handle proxyStrictSSL configuration", () => {
			// Mock VS Code configuration with proxyStrictSSL disabled
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return "http://proxy.example.com:8080"
					if (key === "proxyStrictSSL") return false
					return undefined
				}),
			} as any)

			const axiosInstance = createConfiguredAxiosInstance()

			expect(axiosInstance).toBeDefined()
			expect(mockGetConfiguration).toHaveBeenCalledWith("http")
		})
	})

	describe("getConfiguredAxiosConfig", () => {
		it("should return configuration object with proxy and CA settings", () => {
			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const config = getConfiguredAxiosConfig()

			expect(config).toBeDefined()
			expect(typeof config).toBe("object")
		})

		it("should merge provided configuration with proxy/CA settings", () => {
			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			const customConfig = {
				timeout: 5000,
				headers: {
					"Custom-Header": "value",
				},
			}

			const config = getConfiguredAxiosConfig(customConfig)

			expect(config).toBeDefined()
			expect(config.timeout).toBe(5000)
			expect(config.headers).toEqual({ "Custom-Header": "value" })
		})

		it("should handle configuration errors gracefully", () => {
			// Mock VS Code configuration to throw an error
			mockGetConfiguration.mockImplementation(() => {
				throw new Error("Configuration error")
			})

			// Mock console.warn to avoid test output
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			const config = getConfiguredAxiosConfig()

			expect(config).toEqual({})
			expect(consoleSpy).toHaveBeenCalledWith(
				"Failed to create configured axios config; falling back to provided config",
				expect.objectContaining({
					error: "Configuration error",
				}),
			)

			consoleSpy.mockRestore()
		})
	})

	describe("CA certificate caching", () => {
		it("should cache CA certificates to avoid repeated file reads", () => {
			const mockCaContent = Buffer.from("mock-ca-content")
			const caPath = "/path/to/ca.crt"

			// Set CA environment variable
			process.env.NODE_EXTRA_CA_CERTS = caPath

			// Mock file reading
			mockReadFileSync.mockReturnValue(mockCaContent)

			// Mock VS Code configuration
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string) => {
					if (key === "proxy") return ""
					if (key === "proxyStrictSSL") return true
					return undefined
				}),
			} as any)

			// Create multiple instances
			const axiosInstance1 = createConfiguredAxiosInstance()
			const axiosInstance2 = createConfiguredAxiosInstance()

			expect(axiosInstance1).toBeDefined()
			expect(axiosInstance2).toBeDefined()

			// File should only be read once due to caching
			expect(mockReadFileSync).toHaveBeenCalledTimes(1)
			expect(mockReadFileSync).toHaveBeenCalledWith(caPath)
		})
	})
})
