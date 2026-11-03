FROM python:3.12-slim
RUN useradd -m -u 10001 ctf
WORKDIR /app
COPY app/ /app/
USER ctf
EXPOSE 8000
CMD ["python", "-u", "main.py"]
