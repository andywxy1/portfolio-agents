from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Auth
    api_key: str = "dev-api-key-change-me"

    # Database
    database_url: str = "sqlite:///data/portfolio.db"

    # Alpaca
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_base_url: str = "https://paper-api.alpaca.markets"

    # LLM
    llm_base_url: str = "http://localhost:8317/v1"
    llm_api_key: str = ""
    llm_deep_model: str = "claude-sonnet-4-20250514"
    llm_quick_model: str = "claude-sonnet-4-20250514"

    # Analysis thresholds
    weight_heavy_threshold: float = 0.10
    weight_medium_threshold: float = 0.03
    max_debate_rounds: int = 1
    max_risk_discuss_rounds: int = 1

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
