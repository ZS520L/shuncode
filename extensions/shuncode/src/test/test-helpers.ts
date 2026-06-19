/**
 * Test helpers for Shuncode unit tests.
 * Provides in-memory implementations of VS Code interfaces.
 */

/**
 * In-memory Memento (workspaceState/globalState replacement).
 * Behaves exactly like VS Code's Memento: get/update with JSON-serializable values.
 */
export class InMemoryMemento {
	private store = new Map<string, any>()

	get<T>(key: string, defaultValue?: T): T {
		if (this.store.has(key)) {
			// Simulate JSON round-trip (VS Code stores as JSON)
			return JSON.parse(JSON.stringify(this.store.get(key))) as T
		}
		return defaultValue as T
	}

	async update(key: string, value: any): Promise<void> {
		this.store.set(key, JSON.parse(JSON.stringify(value)))
	}

	keys(): readonly string[] {
		return Array.from(this.store.keys())
	}

	clear(): void {
		this.store.clear()
	}
}
