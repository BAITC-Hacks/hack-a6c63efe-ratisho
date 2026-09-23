FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY app ./app
COPY static ./static
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 DATABASE_PATH=/data/hackalem.sqlite3
EXPOSE 8000
CMD ["python", "server.py"]
