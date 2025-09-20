import { NodeHttpHandler } from "@smithy/node-http-handler"
import * as vscode from "vscode"
import * as fs from "fs"
import * as https from "https"
import type { Agent as HttpAgent } from "http"
import type { Agent as HttpsAgent } from "https"
import { ProxyAgent } from "proxy-agent"
import { logger } from "../../../utils/logging"

// Cache for CA certificates to avoid repeated file I/O
const cachedCertificates: Map<string, Buffer> = new Map()

function loadCACertificate(caPath: string): Buffer | undefined {
	if (!caPath) return undefined

	if (cachedCertificates.has(caPath)) {
		return cachedCertificates.get(caPath)
	}

	try {
		const ca = fs.readFileSync(caPath)
		cachedCertificates.set(caPath, ca)
		return ca
	} catch (e) {
		logger.warn("Failed to read custom CA bundle; continuing without it", {
			ctx: "http",
			error: e instanceof Error ? e.message : String(e),
			caPath,
		})
		return undefined
	}
}

function getProxyConfiguration(): { isProxyConfigured: boolean } {
	const httpConfig = vscode.workspace.getConfiguration("http")
	const vscodeProxy = (httpConfig.get<string>("proxy") || "").trim()

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

function getTLSConfiguration(): { strictSSL: boolean; ca?: Buffer } {
	const httpConfig = vscode.workspace.getConfiguration("http")
	const strictSSL = httpConfig.get<boolean>("proxyStrictSSL", true)

	// Prefer AWS_CA_BUNDLE over NODE_EXTRA_CA_CERTS
	const caPath = (process.env.AWS_CA_BUNDLE || process.env.NODE_EXTRA_CA_CERTS || "").trim()
	const ca = caPath ? loadCACertificate(caPath) : undefined

	return { strictSSL, ca }
}

function createHTTPAgents(
	proxyConfig: { isProxyConfigured: boolean },
	tlsConfig: { strictSSL: boolean; ca?: Buffer },
): { httpAgent?: HttpAgent; httpsAgent?: HttpsAgent } {
	const agentOptions: https.AgentOptions = {
		rejectUnauthorized: tlsConfig.strictSSL,
		...(tlsConfig.ca ? { ca: tlsConfig.ca } : {}),
	}

	if (proxyConfig.isProxyConfigured) {
		const proxyAgent = new ProxyAgent({
			httpsAgent: new https.Agent(agentOptions),
			rejectUnauthorized: tlsConfig.strictSSL,
			...(tlsConfig.ca ? { ca: tlsConfig.ca } : {}),
		})

		return { httpAgent: proxyAgent, httpsAgent: proxyAgent }
	}

	return { httpsAgent: new https.Agent(agentOptions) }
}

export function createProxyAwareNodeHttpHandler(loggerContext: string = "http"): NodeHttpHandler | undefined {
	try {
		const proxyConfig = getProxyConfiguration()
		const tlsConfig = getTLSConfiguration()
		const agents = createHTTPAgents(proxyConfig, tlsConfig)

		return new NodeHttpHandler(agents)
	} catch (err) {
		logger.warn("Failed to initialize custom NodeHttpHandler; falling back to default", {
			ctx: loggerContext,
			error: err instanceof Error ? err.message : String(err),
		})
		return undefined
	}
}

