# Dockerfile for SpeQL on x86_64/amd64 architecture
# Based on Debian bookworm for standard Intel/AMD processors

FROM debian:bookworm-slim

# Metadata
LABEL maintainer="SpeQL Security Team"
LABEL description="SpeQL - Security Query Language for Azure APIs"
LABEL version="1.0"

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV CODEQL_HOME=/opt/codeql
ENV PATH="${CODEQL_HOME}:${PATH}"
ENV JAVA_HOME=/usr/lib/jvm/default-java
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Core utilities
    git \
    wget \
    curl \
    unzip \
    ca-certificates \
    # Java runtime for CodeQL
    openjdk-17-jdk \
    # Python for SpeQL scripts
    python3 \
    python3-pip \
    # Additional utilities
    vim \
    less \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Download and install CodeQL CLI for x86_64
# Using a specific version for reproducibility
ARG CODEQL_VERSION=2.20.4
RUN echo "Installing CodeQL ${CODEQL_VERSION} for x86_64..." && \
    wget -q "https://github.com/github/codeql-cli-binaries/releases/download/v${CODEQL_VERSION}/codeql-linux64.zip" -O /tmp/codeql.zip && \
    mkdir -p /opt && \
    unzip -q /tmp/codeql.zip -d /opt && \
    rm /tmp/codeql.zip && \
    # Verify installation
    codeql version

# Create working directory for SpeQL
WORKDIR /speql

# Copy SpeQL files
COPY analyze.py /speql/
COPY refresh_database.py /speql/
COPY refresh-database.sh /speql/
COPY run-queries.sh /speql/
COPY config/ /speql/config/
COPY queries/ /speql/queries/
COPY database/ /speql/database/

# Make scripts executable
RUN chmod +x /speql/*.sh /speql/*.py

# Create results directory
RUN mkdir -p /speql/results

# Set up volume mount points for results and external specs
VOLUME ["/speql/results", "/speql/azure-rest-api-specs"]

# Verify installation and display versions
RUN echo "=== Installation Summary ===" && \
    echo "Python version:" && python3 --version && \
    echo "Java version:" && java -version 2>&1 | head -1 && \
    echo "CodeQL version:" && codeql version && \
    echo "Git version:" && git --version && \
    echo "=========================="

# Default command: Show welcome message and usage
CMD ["/bin/bash", "-c", "echo '═══════════════════════════════════════════════════════════' && \
     echo '  SpeQL - Security Query Language for Azure APIs' && \
     echo '═══════════════════════════════════════════════════════════' && \
     echo '' && \
     echo 'Available commands:' && \
     echo '  python3 analyze.py              - Run Python-based security analyzer' && \
     echo '  ./refresh-database.sh           - Refresh Azure API database' && \
     echo '  ./run-queries.sh                - Run CodeQL security queries' && \
     echo '  codeql version                  - Show CodeQL version' && \
     echo '' && \
     echo 'To run a command:' && \
     echo '  docker run --rm speql:latest python3 analyze.py' && \
     echo '' && \
     echo 'For interactive shell:' && \
     echo '  docker run --rm -it speql:latest /bin/bash' && \
     echo '' && \
     echo 'Documentation: See README.md and DOCKER.md' && \
     echo '═══════════════════════════════════════════════════════════'"]
