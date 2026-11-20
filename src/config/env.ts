const postgres = {
    host: Bun.env.POSTGRES_HOST ?? "localhost",
    port: Number(Bun.env.POSTGRES_PORT ?? 5432),
    user: Bun.env.POSTGRES_USER ?? "postgres",
    password: Bun.env.POSTGRES_PASSWORD ?? "",
    database: Bun.env.POSTGRES_DB ?? "database_name",
    ssl: Bun.env.POSTGRES_SSL === "true",
};

const credentials = `${postgres.user}:${encodeURIComponent(postgres.password)}`;

export const ENV = {
    port: Number(Bun.env.PORT ?? 8500),
    postgres,
    jwt_secret: Bun.env.JWT_SECRET || "",
    dbUrl:
        Bun.env.DATABASE_URL ||
        `postgresql://${credentials}@${postgres.host}:${postgres.port}/${postgres.database}${postgres.ssl ? "?sslmode=require" : ""}`,
};
