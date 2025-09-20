import * as vscode from "vscode"
import * as fs from "fs"
import * as https from "https"
import * as http from "http"
import axios, { AxiosInstance, AxiosRequestConfig } from "axios"
import { ProxyAgent } from "proxy-agent"

/**
 * Configuration for proxy settings
 */
interface ProxyConfig {
	isProxyConfigured: boolean
}

/**
 * Configuration for TLS settings
 */
interface TLSConfig {
	strictSSL: boolean
	ca?: Buffer
}

/**
 * HTTP agent configuration
 */
interface HTTPAgents {
	httpAgent?: http.Agent
	httpsAgent?: https.Agent
}

/**
 * Cache for loaded CA certificates to avoid repeated I/O operations
 */
const cachedCertificates = new Map<string, Buffer>()

/**
 * Get proxy configuration from VS Code settings and environment variables.
 * Note: We only check if a proxy is configured; proxy-agent handles URL detection.
 */
function getProxyConfiguration(): ProxyConfig {
	const httpConfig = vscode.workspace.getConfiguration("http")
	const vscodeProxy = (httpConfig.get<string>("proxy") || "").trim()

	// Check if any proxy configuration exists (VS Code or environment variables)
	const hasProxyConfig = !!(
		vscodeProxy ||
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy ||
		process.env.ALL_PROXY ||
		process.env.all_proxy
	)

	return { isProxyConfigured: hasProxyConfig }
}

/**
 * Get TLS configuration including SSL validation and CA certificates.
 */
function getTLSConfiguration(): TLSConfig {
	const httpConfig = vscode.workspace.getConfiguration("http")
	const strictSSL = httpConfig.get<boolean>("proxyStrictSSL", true)

	const caPath = (process.env.AWS_CA_BUNDLE || process.env.NODE_EXTRA_CA_CERTS || "").trim()
	const ca = caPath ? loadCACertificate(caPath) : undefined

	return { strictSSL, ca }
}

/**
 * Load CA certificate from file system with caching to avoid repeated I/O operations.
 */
function loadCACertificate(caPath: string): Buffer | undefined {
	if (!caPath) return undefined

	// Check cache first
	if (cachedCertificates.has(caPath)) {
		return cachedCertificates.get(caPath)
	}

	try {
		const ca = fs.readFileSync(caPath)
		cachedCertificates.set(caPath, ca)
		return ca
	} catch (e) {
		console.warn("Failed to read custom CA bundle; continuing without it", {
			error: e instanceof Error ? e.message : String(e),
			caPath,
		})
		return undefined
	}
}

/**
 * Create HTTP/HTTPS agents with proxy and TLS configuration.
 * ProxyAgent automatically detects proxy URLs from environment variables.
 */
function createHTTPAgents(proxyConfig: ProxyConfig, tlsConfig: TLSConfig): HTTPAgents {
	const agentOptions: https.AgentOptions = {
		rejectUnauthorized: tlsConfig.strictSSL,
		...(tlsConfig.ca ? { ca: tlsConfig.ca } : {}),
	}

	if (proxyConfig.isProxyConfigured) {
		// ProxyAgent automatically detects proxy URLs from environment variables
		// We pass TLS configuration through the httpsAgent option
		const proxyAgent = new ProxyAgent({
			httpsAgent: new https.Agent(agentOptions),
			rejectUnauthorized: tlsConfig.strictSSL,
			...(tlsConfig.ca ? { ca: tlsConfig.ca } : {}),
		})

		return {
			httpAgent: proxyAgent,
			httpsAgent: proxyAgent,
		}
	}

	// Direct connection without proxy
	return {
		httpsAgent: new https.Agent(agentOptions),
	}
}

/**
 * Creates an axios instance configured with VS Code's proxy settings and custom Certificate Authorities (CAs).
 *
 * This function centralizes the configuration of HTTP clients to ensure consistent application
 * of proxy settings and custom CAs across the codebase. It respects VS Code's HTTP configuration
 * and environment variables for proxy settings.
 *
 * Environment Variables (automatically detected by proxy-agent):
 * - `HTTPS_PROXY` / `https_proxy`: HTTPS proxy server URL
 * - `HTTP_PROXY` / `http_proxy`: HTTP proxy server URL
 * - `ALL_PROXY` / `all_proxy`: Fallback proxy for all protocols
 * - `NO_PROXY` / `no_proxy`: Comma-separated list of hosts to bypass proxy
 * - `NODE_EXTRA_CA_CERTS`: Path to additional CA certificates file
 * - `AWS_CA_BUNDLE`: Path to AWS-specific CA bundle (takes precedence over NODE_EXTRA_CA_CERTS)
 *
 * VS Code Settings:
 * - `http.proxy`: Proxy URL configured in VS Code
 * - `http.proxyStrictSSL`: Whether to use strict SSL validation for proxy connections
 *
 * @param config Optional axios configuration to merge with the proxy/CA configuration
 * @returns Configured axios instance with proxy and CA support
 */
export function createConfiguredAxiosInstance(config?: AxiosRequestConfig): AxiosInstance {
	try {
		const proxyConfig = getProxyConfiguration()
		const tlsConfig = getTLSConfiguration()
		const agents = createHTTPAgents(proxyConfig, tlsConfig)

		const axiosConfig: AxiosRequestConfig = {
			...config,
			...agents,
		}

		return axios.create(axiosConfig)
	} catch (err) {
		console.warn("Failed to create configured axios instance; falling back to default axios", {
			error: err instanceof Error ? err.message : String(err),
		})
		// Fall back to default axios instance with provided config
		return config ? axios.create(config) : axios.create()
	}
}

/**
 * Creates an axios request configuration object with proxy and CA settings applied.
 * This is useful when you need to pass configuration to existing axios instances
 * rather than creating a new instance.
 *
 * @param config Optional base configuration to merge with proxy/CA settings
 * @returns Axios request configuration with proxy and CA support
 */
export function getConfiguredAxiosConfig(config?: AxiosRequestConfig): AxiosRequestConfig {
	try {
		const proxyConfig = getProxyConfiguration()
		const tlsConfig = getTLSConfiguration()
		const agents = createHTTPAgents(proxyConfig, tlsConfig)

		return {
			...config,
			...agents,
		}
	} catch (err) {
		console.warn("Failed to create configured axios config; falling back to provided config", {
			error: err instanceof Error ? err.message : String(err),
		})
		return config || {}
	}
}

/**
 * Clears the CA certificate cache. This is primarily used for testing.
 * @internal
 */
export function clearCertificateCache(): void {
	cachedCertificates.clear()
}

/**
 * Legacy function for backward compatibility.
 * @deprecated Use createConfiguredAxiosInstance instead
 */
export const createHttpClient = createConfiguredAxiosInstance
