import { useEffect, useState, type FormEvent, type JSX } from "react";
import { z } from "zod";
import { readResponse } from "./api";
const keySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  last_used_at: z.string().nullable(),
});
export function DeveloperKeys(): JSX.Element {
  const [keys, setKeys] = useState<z.infer<typeof keySchema>[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/v1/account/api-keys", { signal: controller.signal })
      .then((response) => readResponse(response, z.array(keySchema)))
      .then(setKeys)
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      const result = await readResponse(
        await fetch("/v1/account/api-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(form.get("name")),
            expires_at: new Date(String(form.get("expiry"))).toISOString(),
          }),
        }),
        z.object({ key: keySchema, token: z.string() }),
      );
      setToken(result.token);
      setKeys((current) => [result.key, ...current]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  async function revoke(id: string): Promise<void> {
    setError(null);
    try {
      const response = await fetch(`/v1/account/api-keys/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) await readResponse(response, z.never());
      setKeys((current) => current.filter((key) => key.id !== id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <section className="panel" data-testid="developer-keys">
      <h2>Developer API</h2>
      <p>
        Keys access your documents and processing jobs. Account and admin
        actions require browser login.
      </p>
      <a href="/docs/" target="_blank" rel="noreferrer">
        Open API documentation
      </a>
      {error && <p role="alert">{error}</p>}
      {token && (
        <div className="notice-banner">
          <label>
            Copy this key now. It is shown once.
            <input data-testid="created-api-key" readOnly value={token} />
          </label>
          <button onClick={() => setToken(null)}>Dismiss</button>
        </div>
      )}
      <form onSubmit={(event) => void create(event)}>
        <label>
          Name
          <input
            name="name"
            data-testid="api-key-name"
            maxLength={80}
            required
          />
        </label>
        <label>
          Expires
          <input
            type="date"
            name="expiry"
            required
            data-testid="api-key-expiry"
          />
        </label>
        <button className="button primary" data-testid="api-key-create">
          Create key
        </button>
      </form>
      {keys.map((key) => (
        <div key={key.id} className="version-row">
          <span>
            {key.name} · {key.prefix}… · expires{" "}
            {new Date(key.expires_at).toLocaleDateString()}
          </span>
          <button
            data-testid={`api-key-revoke-${key.id}`}
            onClick={() => void revoke(key.id)}
          >
            Revoke
          </button>
        </div>
      ))}
    </section>
  );
}
