import type { Context } from 'hono'
import type { login } from './auth.schemas'
import * as authServices from './auth.services'
import { createToken } from '../../config/token'

export const loginHandler = async (c: Context) => {
    try {
        const body: login = await c.req.json()
        const { email, role } = body
        const userData = await authServices.findUser(email, role)
        let token
        if (userData) {
            token = await createToken(userData?.id, role)
        } 
        return c.json({
            success: true,
            data: token
        })
    } catch (err: any) {
        console.error(err)
        return c.json({
            error: {
                code: err.message
            }
        })
    }
}