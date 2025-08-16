FROM python:3.11-slim
RUN apt-get update && apt-get install -y tesseract-ocr libtesseract-dev ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install gunicorn
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["gunicorn","app:app","--workers","4","--bind","0.0.0.0:8080"]
