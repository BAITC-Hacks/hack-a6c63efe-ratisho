FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY app ./app
COPY static ./static
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=10000 DATABASE_PATH=/app/data/hackalem.sqlite3
EXPOSE 10000
CMD ["python", "server.py"]
