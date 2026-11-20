import z from "zod"

export const loginSchema = z.object({
    email: z.email().min(1),
    role: z.enum(["organizer","buyer"])
})

export type login = z.infer<typeof loginSchema>