FROM python:3.11-slim

# Omogućava Docker-u da primi env varijable sa Render-a
ENV PYTHONUNBUFFERED=1

# >>> VAŽNO: prosleđivanje Render environment varijabli u kontejner <<<
ENV SUPABASE_URL=${SUPABASE_URL}
ENV SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
# <<<

WORKDIR /app

COPY world_channels_ID.py .
COPY world ./world

RUN pip install requests pandas supabase

CMD ["python3", "world_channels_ID.py"]
