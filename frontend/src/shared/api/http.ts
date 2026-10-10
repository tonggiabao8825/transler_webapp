import { z } from "zod";
import { errorSchema } from "./contracts";
export async function readResponse<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.infer<T>> {
  const body = await response.json();
  if (!response.ok) {
    const error = errorSchema.parse(body);
    throw new Error(
      `${error.message} (${error.code}, HTTP ${response.status})`,
    );
  }
  return schema.parse(body);
}

export async function request<T extends z.ZodType>(
  path: string,
  method: string,
  body: object | null,
  schema: T,
): Promise<z.infer<T>> {
  return readResponse(
    await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : null,
    }),
    schema,
  );
}
export async function emptyRequest(
  path: string,
  body: object | null,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : null,
  });
  if (!response.ok) await readResponse(response, z.never());
}
