import { EmptyRequest, String } from "@shared/proto/shuncode/common"
import * as vscode from "vscode"

export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	const uriScheme = vscode.env.uriScheme || "vscode"
	const url = `${uriScheme}://shuncode.shuncode`
	return { value: url }
}
