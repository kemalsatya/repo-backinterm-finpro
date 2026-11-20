import { Hono } from "hono";
import router from "./router";
import { HTTPException } from "hono/http-exception";

const app = new Hono()

app.route("/api/", router)

app.onError((err, c) => {
    if (err instanceof HTTPException){
        return c.json({
            error: {
                code: 'UNAUTHORIZED',
                message: err.message
            }
        },
        err.status)
    }

    console.error(err)
    return c.json({
        error: { code: 'INTERNAL_ERROR', 
        message: 'Something went wrong'
        }
    }
    )
})

export default app


// route