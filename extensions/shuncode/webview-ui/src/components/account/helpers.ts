import type { UsageTransaction as ProtoUsageTransaction } from "@shared/proto/shuncode/account"
import type { UsageTransaction as ShuncodeAccountUsageTransaction } from "@shared/ShuncodeAccount"

export const getMainRole = (roles?: string[]) => {
	if (!roles) {
		return undefined
	}

	if (roles.includes("owner")) {
		return "Owner"
	}
	if (roles.includes("admin")) {
		return "Admin"
	}

	return "Member"
}

export const getShuncodeUris = (base: string, type: "dashboard" | "credits", route?: "account" | "organization") => {
	const dashboard = new URL("dashboard", base)

	if (type === "dashboard") {
		return dashboard
	}

	const credits = new URL("/" + (route ?? "account"), dashboard)
	credits.searchParams.set("tab", "credits")
	credits.searchParams.set("redirect", "true")
	return credits
}

/**
 * Converts a protobuf UsageTransaction to a ShuncodeAccount UsageTransaction
 * by adding the missing id and metadata fields
 */
export function convertProtoUsageTransaction(protoTransaction: ProtoUsageTransaction): ShuncodeAccountUsageTransaction {
	return {
		...protoTransaction,
		id: protoTransaction.generationId, // Use generationId as the id
		metadata: {
			additionalProp1: "",
			additionalProp2: "",
			additionalProp3: "",
		},
	}
}

/**
 * Converts an array of protobuf UsageTransactions to ShuncodeAccount UsageTransactions
 */
export function convertProtoUsageTransactions(protoTransactions: ProtoUsageTransaction[]): ShuncodeAccountUsageTransaction[] {
	return protoTransactions.map(convertProtoUsageTransaction)
}
