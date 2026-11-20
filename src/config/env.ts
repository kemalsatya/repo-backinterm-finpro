const postgres = {
    host: Bun.env.POSTGRES_HOST ?? "localhost",
    port: Number(Bun.env.POSTGRES_PORT ?? 5432),
    user: Bun.env.POSTGRES_USER ?? "postgres",
    password: Bun.env.POSTGRES_PASSWORD ?? "",
    database: Bun.env.POSTGRES_DB ?? "database_name",
    ssl: Bun.env.POSTGRES_SSL === "true",
};

const credentials = `${postgres.user}:${encodeURIComponent(postgres.password)}`;

const SUPPORTED_ALGORITHMS = [
    "HS256",
    "HS384",
    "HS512",
] as const;

type JwtAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const resolveJwtAlgorithm = (): JwtAlgorithm => {
    const algorithm = Bun.env.JWT_ALG ?? "HS256";

    if ((SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm)) {
        return algorithm as JwtAlgorithm;
    }

    throw new Error(
        `Unsupported JWT_ALG "${algorithm}". Supported values: ${SUPPORTED_ALGORITHMS.join(", ")}`,
    );
};

export const jwtAlgorithm: JwtAlgorithm = resolveJwtAlgorithm();

export const ENV = {
    port: Number(Bun.env.PORT ?? 8500),
    postgres,
    jwt_secret: Bun.env.JWT_SECRET || "SECRET",
    jwt_alg: jwtAlgorithm,
    dbUrl:
        Bun.env.DATABASE_URL ||
        `postgresql://${credentials}@${postgres.host}:${postgres.port}/${postgres.database}${postgres.ssl ? "?sslmode=require" : ""}`,
};
