"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Core settings for the API server."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://llmuser:llmpass@localhost:5432/llm_dlp"

    # Keycloak OIDC
    KEYCLOAK_URL: str = "http://localhost:8080"
    KEYCLOAK_REALM: str = "llm-dlp"
    KEYCLOAK_CLIENT_ID: str = "llm-dlp-web"
    KEYCLOAK_CLIENT_SECRET: str = "change-me"

    # LiteLLM
    LITELLM_BASE_URL: str = "http://localhost:4000"
    LITELLM_MASTER_KEY: str = "sk-master-key-change-me"
    LITELLM_PUBLIC_URL: str = "http://localhost:4000"  # 对外暴露给用户的 LiteLLM 访问地址

    # Default model (seeded on first startup via LiteLLM admin API)
    DEEPSEEK_API_KEY: str = ""  # Set to seed the default deepseek-v4-flash model

    # App
    APP_SECRET_KEY: str = "dev-secret-key-change-me"
    APP_LOG_LEVEL: str = "DEBUG"
    CORS_ORIGINS: str = "http://localhost:5173"

    # MinIO / Object Storage
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "llm-dlp-files"
    MINIO_SECURE: bool = False

    # File upload limits
    MAX_FILE_SIZE_MB: int = 20
    MAX_FILES_PER_MESSAGE: int = 5

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def keycloak_openid_config_url(self) -> str:
        return f"{self.KEYCLOAK_URL}/realms/{self.KEYCLOAK_REALM}/.well-known/openid-configuration"


settings = Settings()
