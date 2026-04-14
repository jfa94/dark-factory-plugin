# Setting Up Local LLM Fallback

This guide covers configuring Ollama as a fallback when Anthropic API rate limits approach.

## When Fallback Activates

Local LLM fallback is **limit-triggered only**. It activates when:

1. The 5-hour burst window utilization exceeds the hourly threshold
2. The 7-day rolling window utilization exceeds the daily threshold

The pipeline checks both windows before each task spawn. If either limit is exceeded and `localLlm.enabled` is true, tasks route to Ollama.

## Prerequisites

1. **Ollama installed**: Download from [ollama.ai](https://ollama.ai)
2. **16GB+ RAM**: Required for the default 14B model
3. **GPU recommended**: CPU inference works but is slow

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

## Step 1: Enable Fallback

```
/dark-factory:configure
> Set localLlm.enabled to true
```

## Step 2: Choose a Model

The default model is `qwen2.5-coder:14b`. Choose based on available VRAM:

| VRAM  | Model         | Command                         |
| ----- | ------------- | ------------------------------- |
| 8GB   | 7B            | `ollama pull qwen2.5-coder:7b`  |
| 16GB+ | 14B (default) | `ollama pull qwen2.5-coder:14b` |
| 24GB+ | 32B           | `ollama pull qwen2.5-coder:32b` |

To change the model:

```
/dark-factory:configure
> Set localLlm.model to qwen2.5-coder:32b
```

The model auto-pulls on first use if not present locally.

## Step 3: Verify Setup

Run a test:

```bash
# Check model is available
ollama list | grep qwen2.5-coder

# Test inference
ollama run qwen2.5-coder:14b "Write a hello world function in TypeScript"
```

---

## Remote Ollama Setup

To run Ollama on a separate machine (e.g., a GPU server):

### On the Server

Start Ollama bound to all interfaces:

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Pull the model:

```bash
ollama pull qwen2.5-coder:14b
```

### On the Client

Configure the plugin to use the remote server:

```
/dark-factory:configure
> Set localLlm.ollamaUrl to http://192.168.1.50:11434
```

Replace `192.168.1.50` with your server's IP.

Verify connectivity:

```bash
curl http://192.168.1.50:11434/api/tags
```

### Security Note

Ollama has no built-in authentication. Only expose on a trusted network. For remote access over untrusted networks, use:

- SSH tunnel: `ssh -L 11434:localhost:11434 server`
- Reverse proxy (nginx/caddy) with authentication

---

## Quality Tradeoffs

Local models have lower capability than cloud models. The pipeline compensates by:

1. **Elevated review rounds**: Routine=15, Feature=20, Security=25 (vs cloud 2/4/6)
2. **Same quality thresholds**: Coverage, holdout, mutation targets are unchanged
3. **Full quality gate stack**: All 5 layers still apply

If Ollama exhausts its elevated review cap without passing:

- **5h limit triggered**: Pipeline waits for cloud reset, retries with Claude
- **7d limit triggered**: Pipeline ends gracefully, marks run as `partial`

---

## Troubleshooting

### Model not found

```
Error: model 'qwen2.5-coder:14b' not found
```

Pull the model:

```bash
ollama pull qwen2.5-coder:14b
```

### Out of memory

```
Error: CUDA out of memory
```

Use a smaller model:

```
/dark-factory:configure
> Set localLlm.model to qwen2.5-coder:7b
```

Or increase GPU memory allocation in Ollama settings.

### Slow inference

CPU inference is significantly slower than GPU. Options:

1. Use a smaller model (7B instead of 14B)
2. Run on a machine with a GPU
3. Accept slower execution during rate-limited periods

### Connection refused

```
Error: connection refused to localhost:11434
```

Start the Ollama server:

```bash
ollama serve
```

For remote servers, verify the server is running and firewalls allow port 11434.

---

## Advanced: LiteLLM Proxy

For teams or heavy usage, LiteLLM provides unified multi-provider routing:

1. Install: `pip install litellm`

2. Create `litellm_config.yaml`:

```yaml
model_list:
  - model_name: default
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
  - model_name: fallback
    litellm_params:
      model: ollama/qwen2.5-coder:32b
      api_base: http://localhost:11434

router_settings:
  fallbacks:
    - default: [fallback]
```

3. Start proxy: `litellm --config litellm_config.yaml`

4. Configure plugin:

```
/dark-factory:configure
> Set localLlm.useLiteLlm to true
> Set localLlm.liteLlmUrl to http://localhost:4000
```

Benefits:

- Automatic fallback handling
- Cost tracking across providers
- Latency logging
- Model-level observability

Trade-off: Adds a dependency. Only recommended for advanced users.
