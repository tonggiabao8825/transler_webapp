import {
  accountSchema,
  profileSchema,
  type Account,
  type Profile,
} from "./account-contracts";
import { emptyRequest, request } from "./http";
export class AccountApi {
  async login(email: string, password: string): Promise<Account> {
    return request(
      "/v1/auth/login",
      "POST",
      { email, password },
      accountSchema,
    );
  }

  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<Account> {
    return request(
      "/v1/auth/register",
      "POST",
      { name, email, password },
      accountSchema,
    );
  }

  async logout(): Promise<void> {
    await emptyRequest("/v1/auth/logout", null);
  }

  async profile(): Promise<Profile> {
    return request("/v1/account", "GET", null, profileSchema);
  }

  async rename(name: string): Promise<Account> {
    return request("/v1/account", "PATCH", { name }, accountSchema);
  }

  async password(
    current_password: string,
    new_password: string,
  ): Promise<void> {
    await emptyRequest("/v1/account/password", {
      current_password,
      new_password,
    });
  }
}
