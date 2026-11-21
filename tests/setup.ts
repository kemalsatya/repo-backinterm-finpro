const testDbUrl = Bun.env.TEST_DATABASE_URL;

if (testDbUrl) {
    process.env.DATABASE_URL = testDbUrl;
}
