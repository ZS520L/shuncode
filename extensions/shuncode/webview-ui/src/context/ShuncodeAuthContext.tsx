import type { UserOrganization } from "@shared/proto/shuncode/account"
import { EmptyRequest } from "@shared/proto/shuncode/common"
import deepEqual from "fast-deep-equal"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"

// Define User type (you may need to adjust this based on your actual User type)
export interface ShuncodeUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
	appBaseUrl?: string
}

export interface ShuncodeAuthContextType {
	shuncodeUser: ShuncodeUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
}

export const ShuncodeAuthContext = createContext<ShuncodeAuthContextType | undefined>(undefined)

export const ShuncodeAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<ShuncodeUser | null>(null)
	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[] | null>(null)

	const getUserOrganizations = useCallback(async () => {
		try {
			const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
			setUserOrganizations((old) => {
				if (!deepEqual(response.organizations, old)) {
					return response.organizations
				}

				return old
			})
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
		}
	}, [])

	const activeOrganization = useMemo(() => {
		return userOrganizations?.find((org) => org.active) ?? null
	}, [userOrganizations])

	useEffect(() => {
		console.log("Extension: ShuncodeAuthContext: user updated:", user?.uid)
	}, [user?.uid])

	// Handle auth status update events
	useEffect(() => {
		const cancelSubscription = AccountServiceClient.subscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: async (response) => {
				setUser((oldUser) => {
					if (!response?.user?.uid) {
						return null
					}

					if (response?.user && oldUser?.uid !== response.user.uid) {
						// Once we have a new user, fetch organizations that
						// allow us to display the active account in account view UI
						// and fetch the correct credit balance to display on mount
						getUserOrganizations()
						return response.user
					}

					return oldUser
				})
			},
			onError: (error: Error) => {
				console.error("Error in auth callback subscription:", error)
			},
			onComplete: () => {
				console.log("Auth callback subscription completed")
			},
		})

		// Cleanup function to cancel subscription when component unmounts
		return () => {
			cancelSubscription()
		}
	}, [getUserOrganizations])

	return (
		<ShuncodeAuthContext.Provider
			value={{
				shuncodeUser: user,
				organizations: userOrganizations,
				activeOrganization,
			}}>
			{children}
		</ShuncodeAuthContext.Provider>
	)
}

export const useShuncodeAuth = () => {
	const context = useContext(ShuncodeAuthContext)
	if (context === undefined) {
		throw new Error("useShuncodeAuth must be used within a ShuncodeAuthProvider")
	}
	return context
}

export const useShuncodeSignIn = () => {
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleSignIn = useCallback(() => {
		setIsLoading(true)
		setError(null)

		AccountServiceClient.accountLoginClicked(EmptyRequest.create())
			.catch((err) => {
				console.error("Failed to get login URL:", err)
				const message = err instanceof Error ? err.message : String(err)
				setError(message || "Authentication request failed")
			})
			.finally(() => {
				setIsLoading(false)
			})
	}, [])

	const clearError = useCallback(() => setError(null), [])

	return {
		isLoginLoading: isLoading,
		loginError: error,
		clearError,
		handleSignIn,
	}
}

export const handleSignOut = async () => {
	try {
		await AccountServiceClient.accountLogoutClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to logout:", err),
		)
	} catch (error) {
		console.error("Error signing out:", error)
		throw error
	}
}
