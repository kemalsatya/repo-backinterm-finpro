const postgres = {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "",
    database: process.env.POSTGRES_DB ?? "database_name",
    ssl: process.env.POSTGRES_SSL === "true",
};

const credentials = `${postgres.user}:${encodeURIComponent(postgres.password)}`;

const SUPPORTED_ALGORITHMS = ["HS256", "HS384", "HS512"] as const;

type JwtAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const resolveJwtAlgorithm = (): JwtAlgorithm => {
    const algorithm = process.env.JWT_ALG ?? "HS256";

    if ((SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm)) {
        return algorithm as JwtAlgorithm;
    }

    throw new Error(
        `Unsupported JWT_ALG "${algorithm}". Supported values: ${SUPPORTED_ALGORITHMS.join(", ")}`,
    );
};

export const jwtAlgorithm: JwtAlgorithm = resolveJwtAlgorithm();

export const ENV = {
    port: Number(process.env.PORT ?? 8500),
    postgres,
    jwt_secret: process.env.JWT_SECRET || "SECRET",
    jwt_alg: jwtAlgorithm,
    order_sweeper: {
        enabled: process.env.ORDER_SWEEPER_ENABLED !== "false",
        interval_ms: Number(process.env.ORDER_SWEEPER_INTERVAL_MS ?? 60_000),
        batch_size: Number(process.env.ORDER_SWEEPER_BATCH_SIZE ?? 100),
    },
    dbUrl:
        process.env.DATABASE_URL ||
        `postgresql://${credentials}@${postgres.host}:${postgres.port}/${postgres.database}${postgres.ssl ? "?sslmode=require" : ""}`,
};
