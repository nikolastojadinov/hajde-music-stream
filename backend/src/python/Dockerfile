FROM python:3.11-slim

WORKDIR /app

COPY world_channels_ID.py .
COPY world ./world

RUN pip install requests pandas

CMD ["python3", "world_channels_ID.py"]
