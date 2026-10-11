import {ContractEvent} from './types.js';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Returns the allowance for `spender` to transfer from `from`.
   *
   * The amount returned is the amount that spender is allowed to transfer
   * out of from's balance. When the spender transfers amounts, the allowance
   * will be reduced by the amount transferred.
   *
   * # Arguments
   *
   * * `from` - The address holding the balance of tokens to be drawn from.
   * * `spender` - The address spending the tokens held by `from`.
   */
  allowance(args: { from: string | Address; spender: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Returns true if `id` is authorized to use its balance.
   *
   * # Arguments
   *
   * * `id` - The address for which token authorization is being checked.
   */
  authorized(args: { id: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Set the allowance by `amount` for `spender` to transfer/burn from
   * `from`.
   *
   * The amount set is the amount that spender is approved to transfer out of
   * from's balance. The spender will be allowed to transfer amounts, and
   * when an amount is transferred the allowance will be reduced by the
   * amount transferred.
   *
   * # Arguments
   *
   * * `from` - The address holding the balance of tokens to be drawn from.
   * * `spender` - The address being authorized to spend the tokens held by
   * `from`.
   * * `amount` - The tokens to be made available to `spender`.
   * * `expiration_ledger` - The ledger number where this allowance expires. Cannot
   * be less than the current ledger number unless the amount is being set to 0.
   * An expired entry (where expiration_ledger < the current ledger number)
   * should be treated as a 0 amount allowance.
   *
   * # Events
   *
   * Emits an event with topics `["approve", from: Address,
   * spender: Address], data = [amount: i128, expiration_ledger: u32]`
   */
  approve(args: { from: string | Address; spender: string | Address; amount: bigint; expiration_ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the balance of `id`.
   *
   * # Arguments
   *
   * * `id` - The address for which a balance is being queried. If the
   * address has no existing balance, returns 0.
   */
  balance(args: { id: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Burn `amount` from `from`.
   *
   * Reduces from's balance by the amount, without transferring the balance
   * to another holder's balance.
   *
   * # Arguments
   *
   * * `from` - The address holding the balance of tokens which will be
   * burned from.
   * * `amount` - The amount of tokens to be burned.
   *
   * # Events
   *
   * Emits an event with topics `["burn", from: Address], data = amount:
   * i128`
   */
  burn(args: { from: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Burn `amount` from `from`, consuming the allowance of `spender`.
   *
   * Reduces from's balance by the amount, without transferring the balance
   * to another holder's balance.
   *
   * The spender will be allowed to burn the amount from from's balance, if
   * the amount is less than or equal to the allowance that the spender has
   * on the from's balance. The spender's allowance on from's balance will be
   * reduced by the amount.
   *
   * # Arguments
   *
   * * `spender` - The address authorizing the burn, and having its allowance
   * consumed during the burn.
   * * `from` - The address holding the balance of tokens which will be
   * burned from.
   * * `amount` - The amount of tokens to be burned.
   *
   * # Events
   *
   * Emits an event with topics `["burn", from: Address], data = amount:
   * i128`
   */
  burn_from(args: { spender: string | Address; from: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Clawback `amount` from `from` account. `amount` is burned in the
   * clawback process.
   *
   * # Arguments
   *
   * * `from` - The address holding the balance from which the clawback will
   * take tokens.
   * * `amount` - The amount of tokens to be clawed back.
   *
   * # Events
   *
   * Emits an event with topics `["clawback", admin: Address, to: Address],
   * data = amount: i128`
   */
  clawback(args: { from: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the number of decimals used to represent amounts of this token.
   *
   * # Panics
   *
   * If the contract has not yet been initialized.
   */
  decimals(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Mints `amount` to `to`.
   *
   * # Arguments
   *
   * * `to` - The address which will receive the minted tokens.
   * * `amount` - The amount of tokens to be minted.
   *
   * # Events
   *
   * Emits an event with topics `["mint", admin: Address, to: Address], data
   * = amount: i128`
   */
  mint(args: { to: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the name for this token.
   *
   * # Panics
   *
   * If the contract has not yet been initialized.
   */
  name(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Sets the administrator to the specified address `new_admin`.
   *
   * # Arguments
   *
   * * `new_admin` - The address which will henceforth be the administrator
   * of this token contract.
   *
   * # Events
   *
   * Emits an event with topics `["set_admin", admin: Address], data =
   * [new_admin: Address]`
   */
  set_admin(args: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the admin of the contract.
   *
   * # Panics
   *
   * If the admin is not set.
   */
  admin(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Sets whether the account is authorized to use its balance. If
   * `authorized` is true, `id` should be able to use its balance.
   *
   * # Arguments
   *
   * * `id` - The address being (de-)authorized.
   * * `authorize` - Whether or not `id` can use its balance.
   *
   * # Events
   *
   * Emits an event with topics `["set_authorized", id: Address], data =
   * [authorize: bool]`
   */
  set_authorized(args: { id: string | Address; authorize: boolean }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the symbol for this token.
   *
   * # Panics
   *
   * If the contract has not yet been initialized.
   */
  symbol(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Transfer `amount` from `from` to `to`.
   *
   * # Arguments
   *
   * * `from` - The address holding the balance of tokens which will be
   * withdrawn from.
   * * `to` - The address which will receive the transferred tokens.
   * * `amount` - The amount of tokens to be transferred.
   *
   * # Events
   *
   * Emits an event with topics `["transfer", from: Address, to: Address],
   * data = amount: i128`
   */
  transfer(args: { from: string | Address; to: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Transfer `amount` from `from` to `to`, consuming the allowance that
   * `spender` has on `from`'s balance. Authorized by spender
   * (`spender.require_auth()`).
   *
   * The spender will be allowed to transfer the amount from from's balance
   * if the amount is less than or equal to the allowance that the spender
   * has on the from's balance. The spender's allowance on from's balance
   * will be reduced by the amount.
   *
   * # Arguments
   *
   * * `spender` - The address authorizing the transfer, and having its
   * allowance consumed during the transfer.
   * * `from` - The address holding the balance of tokens which will be
   * withdrawn from.
   * * `to` - The address which will receive the transferred tokens.
   * * `amount` - The amount of tokens to be transferred.
   *
   * # Events
   *
   * Emits an event with topics `["transfer", from: Address, to: Address],
   * data = amount: i128`
   */
  transfer_from(args: { spender: string | Address; from: string | Address; to: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAAAAAYpSZXR1cm5zIHRoZSBhbGxvd2FuY2UgZm9yIGBzcGVuZGVyYCB0byB0cmFuc2ZlciBmcm9tIGBmcm9tYC4KClRoZSBhbW91bnQgcmV0dXJuZWQgaXMgdGhlIGFtb3VudCB0aGF0IHNwZW5kZXIgaXMgYWxsb3dlZCB0byB0cmFuc2ZlcgpvdXQgb2YgZnJvbSdzIGJhbGFuY2UuIFdoZW4gdGhlIHNwZW5kZXIgdHJhbnNmZXJzIGFtb3VudHMsIHRoZSBhbGxvd2FuY2UKd2lsbCBiZSByZWR1Y2VkIGJ5IHRoZSBhbW91bnQgdHJhbnNmZXJyZWQuCgojIEFyZ3VtZW50cwoKKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSBiYWxhbmNlIG9mIHRva2VucyB0byBiZSBkcmF3biBmcm9tLgoqIGBzcGVuZGVyYCAtIFRoZSBhZGRyZXNzIHNwZW5kaW5nIHRoZSB0b2tlbnMgaGVsZCBieSBgZnJvbWAuAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL", "AAAAAAAAAIlSZXR1cm5zIHRydWUgaWYgYGlkYCBpcyBhdXRob3JpemVkIHRvIHVzZSBpdHMgYmFsYW5jZS4KCiMgQXJndW1lbnRzCgoqIGBpZGAgLSBUaGUgYWRkcmVzcyBmb3Igd2hpY2ggdG9rZW4gYXV0aG9yaXphdGlvbiBpcyBiZWluZyBjaGVja2VkLgAAAAAAAAphdXRob3JpemVkAAAAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAB", "AAAAAAAAA59TZXQgdGhlIGFsbG93YW5jZSBieSBgYW1vdW50YCBmb3IgYHNwZW5kZXJgIHRvIHRyYW5zZmVyL2J1cm4gZnJvbQpgZnJvbWAuCgpUaGUgYW1vdW50IHNldCBpcyB0aGUgYW1vdW50IHRoYXQgc3BlbmRlciBpcyBhcHByb3ZlZCB0byB0cmFuc2ZlciBvdXQgb2YKZnJvbSdzIGJhbGFuY2UuIFRoZSBzcGVuZGVyIHdpbGwgYmUgYWxsb3dlZCB0byB0cmFuc2ZlciBhbW91bnRzLCBhbmQKd2hlbiBhbiBhbW91bnQgaXMgdHJhbnNmZXJyZWQgdGhlIGFsbG93YW5jZSB3aWxsIGJlIHJlZHVjZWQgYnkgdGhlCmFtb3VudCB0cmFuc2ZlcnJlZC4KCiMgQXJndW1lbnRzCgoqIGBmcm9tYCAtIFRoZSBhZGRyZXNzIGhvbGRpbmcgdGhlIGJhbGFuY2Ugb2YgdG9rZW5zIHRvIGJlIGRyYXduIGZyb20uCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYmVpbmcgYXV0aG9yaXplZCB0byBzcGVuZCB0aGUgdG9rZW5zIGhlbGQgYnkKYGZyb21gLgoqIGBhbW91bnRgIC0gVGhlIHRva2VucyB0byBiZSBtYWRlIGF2YWlsYWJsZSB0byBgc3BlbmRlcmAuCiogYGV4cGlyYXRpb25fbGVkZ2VyYCAtIFRoZSBsZWRnZXIgbnVtYmVyIHdoZXJlIHRoaXMgYWxsb3dhbmNlIGV4cGlyZXMuIENhbm5vdApiZSBsZXNzIHRoYW4gdGhlIGN1cnJlbnQgbGVkZ2VyIG51bWJlciB1bmxlc3MgdGhlIGFtb3VudCBpcyBiZWluZyBzZXQgdG8gMC4KQW4gZXhwaXJlZCBlbnRyeSAod2hlcmUgZXhwaXJhdGlvbl9sZWRnZXIgPCB0aGUgY3VycmVudCBsZWRnZXIgbnVtYmVyKQpzaG91bGQgYmUgdHJlYXRlZCBhcyBhIDAgYW1vdW50IGFsbG93YW5jZS4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJhcHByb3ZlIiwgZnJvbTogQWRkcmVzcywKc3BlbmRlcjogQWRkcmVzc10sIGRhdGEgPSBbYW1vdW50OiBpMTI4LCBleHBpcmF0aW9uX2xlZGdlcjogdTMyXWAAAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAABFleHBpcmF0aW9uX2xlZGdlcgAAAAAAAAQAAAAA", "AAAAAAAAAJhSZXR1cm5zIHRoZSBiYWxhbmNlIG9mIGBpZGAuCgojIEFyZ3VtZW50cwoKKiBgaWRgIC0gVGhlIGFkZHJlc3MgZm9yIHdoaWNoIGEgYmFsYW5jZSBpcyBiZWluZyBxdWVyaWVkLiBJZiB0aGUKYWRkcmVzcyBoYXMgbm8gZXhpc3RpbmcgYmFsYW5jZSwgcmV0dXJucyAwLgAAAAdiYWxhbmNlAAAAAAEAAAAAAAAAAmlkAAAAAAATAAAAAQAAAAs=", "AAAAAAAAAWJCdXJuIGBhbW91bnRgIGZyb20gYGZyb21gLgoKUmVkdWNlcyBmcm9tJ3MgYmFsYW5jZSBieSB0aGUgYW1vdW50LCB3aXRob3V0IHRyYW5zZmVycmluZyB0aGUgYmFsYW5jZQp0byBhbm90aGVyIGhvbGRlcidzIGJhbGFuY2UuCgojIEFyZ3VtZW50cwoKKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSBiYWxhbmNlIG9mIHRva2VucyB3aGljaCB3aWxsIGJlCmJ1cm5lZCBmcm9tLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgdG8gYmUgYnVybmVkLgoKIyBFdmVudHMKCkVtaXRzIGFuIGV2ZW50IHdpdGggdG9waWNzIGBbImJ1cm4iLCBmcm9tOiBBZGRyZXNzXSwgZGF0YSA9IGFtb3VudDoKaTEyOGAAAAAAAARidXJuAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=", "AAAAAAAAAtpCdXJuIGBhbW91bnRgIGZyb20gYGZyb21gLCBjb25zdW1pbmcgdGhlIGFsbG93YW5jZSBvZiBgc3BlbmRlcmAuCgpSZWR1Y2VzIGZyb20ncyBiYWxhbmNlIGJ5IHRoZSBhbW91bnQsIHdpdGhvdXQgdHJhbnNmZXJyaW5nIHRoZSBiYWxhbmNlCnRvIGFub3RoZXIgaG9sZGVyJ3MgYmFsYW5jZS4KClRoZSBzcGVuZGVyIHdpbGwgYmUgYWxsb3dlZCB0byBidXJuIHRoZSBhbW91bnQgZnJvbSBmcm9tJ3MgYmFsYW5jZSwgaWYKdGhlIGFtb3VudCBpcyBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gdGhlIGFsbG93YW5jZSB0aGF0IHRoZSBzcGVuZGVyIGhhcwpvbiB0aGUgZnJvbSdzIGJhbGFuY2UuIFRoZSBzcGVuZGVyJ3MgYWxsb3dhbmNlIG9uIGZyb20ncyBiYWxhbmNlIHdpbGwgYmUKcmVkdWNlZCBieSB0aGUgYW1vdW50LgoKIyBBcmd1bWVudHMKCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYXV0aG9yaXppbmcgdGhlIGJ1cm4sIGFuZCBoYXZpbmcgaXRzIGFsbG93YW5jZQpjb25zdW1lZCBkdXJpbmcgdGhlIGJ1cm4uCiogYGZyb21gIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgYmFsYW5jZSBvZiB0b2tlbnMgd2hpY2ggd2lsbCBiZQpidXJuZWQgZnJvbS4KKiBgYW1vdW50YCAtIFRoZSBhbW91bnQgb2YgdG9rZW5zIHRvIGJlIGJ1cm5lZC4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJidXJuIiwgZnJvbTogQWRkcmVzc10sIGRhdGEgPSBhbW91bnQ6CmkxMjhgAAAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==", "AAAAAAAAAVFDbGF3YmFjayBgYW1vdW50YCBmcm9tIGBmcm9tYCBhY2NvdW50LiBgYW1vdW50YCBpcyBidXJuZWQgaW4gdGhlCmNsYXdiYWNrIHByb2Nlc3MuCgojIEFyZ3VtZW50cwoKKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSBiYWxhbmNlIGZyb20gd2hpY2ggdGhlIGNsYXdiYWNrIHdpbGwKdGFrZSB0b2tlbnMuCiogYGFtb3VudGAgLSBUaGUgYW1vdW50IG9mIHRva2VucyB0byBiZSBjbGF3ZWQgYmFjay4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJjbGF3YmFjayIsIGFkbWluOiBBZGRyZXNzLCB0bzogQWRkcmVzc10sCmRhdGEgPSBhbW91bnQ6IGkxMjhgAAAAAAAACGNsYXdiYWNrAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=", "AAAAAAAAAIBSZXR1cm5zIHRoZSBudW1iZXIgb2YgZGVjaW1hbHMgdXNlZCB0byByZXByZXNlbnQgYW1vdW50cyBvZiB0aGlzIHRva2VuLgoKIyBQYW5pY3MKCklmIHRoZSBjb250cmFjdCBoYXMgbm90IHlldCBiZWVuIGluaXRpYWxpemVkLgAAAAhkZWNpbWFscwAAAAAAAAABAAAABA==", "AAAAAAAAAPNNaW50cyBgYW1vdW50YCB0byBgdG9gLgoKIyBBcmd1bWVudHMKCiogYHRvYCAtIFRoZSBhZGRyZXNzIHdoaWNoIHdpbGwgcmVjZWl2ZSB0aGUgbWludGVkIHRva2Vucy4KKiBgYW1vdW50YCAtIFRoZSBhbW91bnQgb2YgdG9rZW5zIHRvIGJlIG1pbnRlZC4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJtaW50IiwgYWRtaW46IEFkZHJlc3MsIHRvOiBBZGRyZXNzXSwgZGF0YQo9IGFtb3VudDogaTEyOGAAAAAABG1pbnQAAAACAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==", "AAAAAAAAAFlSZXR1cm5zIHRoZSBuYW1lIGZvciB0aGlzIHRva2VuLgoKIyBQYW5pY3MKCklmIHRoZSBjb250cmFjdCBoYXMgbm90IHlldCBiZWVuIGluaXRpYWxpemVkLgAAAAAAAARuYW1lAAAAAAAAAAEAAAAQ", "AAAAAAAAAQxTZXRzIHRoZSBhZG1pbmlzdHJhdG9yIHRvIHRoZSBzcGVjaWZpZWQgYWRkcmVzcyBgbmV3X2FkbWluYC4KCiMgQXJndW1lbnRzCgoqIGBuZXdfYWRtaW5gIC0gVGhlIGFkZHJlc3Mgd2hpY2ggd2lsbCBoZW5jZWZvcnRoIGJlIHRoZSBhZG1pbmlzdHJhdG9yCm9mIHRoaXMgdG9rZW4gY29udHJhY3QuCgojIEV2ZW50cwoKRW1pdHMgYW4gZXZlbnQgd2l0aCB0b3BpY3MgYFsic2V0X2FkbWluIiwgYWRtaW46IEFkZHJlc3NdLCBkYXRhID0KW25ld19hZG1pbjogQWRkcmVzc11gAAAACXNldF9hZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAEZSZXR1cm5zIHRoZSBhZG1pbiBvZiB0aGUgY29udHJhY3QuCgojIFBhbmljcwoKSWYgdGhlIGFkbWluIGlzIG5vdCBzZXQuAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=", "AAAAAAAAAVBTZXRzIHdoZXRoZXIgdGhlIGFjY291bnQgaXMgYXV0aG9yaXplZCB0byB1c2UgaXRzIGJhbGFuY2UuIElmCmBhdXRob3JpemVkYCBpcyB0cnVlLCBgaWRgIHNob3VsZCBiZSBhYmxlIHRvIHVzZSBpdHMgYmFsYW5jZS4KCiMgQXJndW1lbnRzCgoqIGBpZGAgLSBUaGUgYWRkcmVzcyBiZWluZyAoZGUtKWF1dGhvcml6ZWQuCiogYGF1dGhvcml6ZWAgLSBXaGV0aGVyIG9yIG5vdCBgaWRgIGNhbiB1c2UgaXRzIGJhbGFuY2UuCgojIEV2ZW50cwoKRW1pdHMgYW4gZXZlbnQgd2l0aCB0b3BpY3MgYFsic2V0X2F1dGhvcml6ZWQiLCBpZDogQWRkcmVzc10sIGRhdGEgPQpbYXV0aG9yaXplOiBib29sXWAAAAAOc2V0X2F1dGhvcml6ZWQAAAAAAAIAAAAAAAAAAmlkAAAAAAATAAAAAAAAAAlhdXRob3JpemUAAAAAAAABAAAAAA==", "AAAAAAAAAFtSZXR1cm5zIHRoZSBzeW1ib2wgZm9yIHRoaXMgdG9rZW4uCgojIFBhbmljcwoKSWYgdGhlIGNvbnRyYWN0IGhhcyBub3QgeWV0IGJlZW4gaW5pdGlhbGl6ZWQuAAAAAAZzeW1ib2wAAAAAAAAAAAABAAAAEA==", "AAAAAAAAAWJUcmFuc2ZlciBgYW1vdW50YCBmcm9tIGBmcm9tYCB0byBgdG9gLgoKIyBBcmd1bWVudHMKCiogYGZyb21gIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgYmFsYW5jZSBvZiB0b2tlbnMgd2hpY2ggd2lsbCBiZQp3aXRoZHJhd24gZnJvbS4KKiBgdG9gIC0gVGhlIGFkZHJlc3Mgd2hpY2ggd2lsbCByZWNlaXZlIHRoZSB0cmFuc2ZlcnJlZCB0b2tlbnMuCiogYGFtb3VudGAgLSBUaGUgYW1vdW50IG9mIHRva2VucyB0byBiZSB0cmFuc2ZlcnJlZC4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJ0cmFuc2ZlciIsIGZyb206IEFkZHJlc3MsIHRvOiBBZGRyZXNzXSwKZGF0YSA9IGFtb3VudDogaTEyOGAAAAAAAAh0cmFuc2ZlcgAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==", "AAAAAAAAAzFUcmFuc2ZlciBgYW1vdW50YCBmcm9tIGBmcm9tYCB0byBgdG9gLCBjb25zdW1pbmcgdGhlIGFsbG93YW5jZSB0aGF0CmBzcGVuZGVyYCBoYXMgb24gYGZyb21gJ3MgYmFsYW5jZS4gQXV0aG9yaXplZCBieSBzcGVuZGVyCihgc3BlbmRlci5yZXF1aXJlX2F1dGgoKWApLgoKVGhlIHNwZW5kZXIgd2lsbCBiZSBhbGxvd2VkIHRvIHRyYW5zZmVyIHRoZSBhbW91bnQgZnJvbSBmcm9tJ3MgYmFsYW5jZQppZiB0aGUgYW1vdW50IGlzIGxlc3MgdGhhbiBvciBlcXVhbCB0byB0aGUgYWxsb3dhbmNlIHRoYXQgdGhlIHNwZW5kZXIKaGFzIG9uIHRoZSBmcm9tJ3MgYmFsYW5jZS4gVGhlIHNwZW5kZXIncyBhbGxvd2FuY2Ugb24gZnJvbSdzIGJhbGFuY2UKd2lsbCBiZSByZWR1Y2VkIGJ5IHRoZSBhbW91bnQuCgojIEFyZ3VtZW50cwoKKiBgc3BlbmRlcmAgLSBUaGUgYWRkcmVzcyBhdXRob3JpemluZyB0aGUgdHJhbnNmZXIsIGFuZCBoYXZpbmcgaXRzCmFsbG93YW5jZSBjb25zdW1lZCBkdXJpbmcgdGhlIHRyYW5zZmVyLgoqIGBmcm9tYCAtIFRoZSBhZGRyZXNzIGhvbGRpbmcgdGhlIGJhbGFuY2Ugb2YgdG9rZW5zIHdoaWNoIHdpbGwgYmUKd2l0aGRyYXduIGZyb20uCiogYHRvYCAtIFRoZSBhZGRyZXNzIHdoaWNoIHdpbGwgcmVjZWl2ZSB0aGUgdHJhbnNmZXJyZWQgdG9rZW5zLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgdG8gYmUgdHJhbnNmZXJyZWQuCgojIEV2ZW50cwoKRW1pdHMgYW4gZXZlbnQgd2l0aCB0b3BpY3MgYFsidHJhbnNmZXIiLCBmcm9tOiBBZGRyZXNzLCB0bzogQWRkcmVzc10sCmRhdGEgPSBhbW91bnQ6IGkxMjhgAAAAAAAADXRyYW5zZmVyX2Zyb20AAAAAAAAEAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==", "AAAABQAAAAAAAAAAAAAAB0FwcHJvdmUAAAAAAQAAAAdhcHByb3ZlAAAAAAQAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAARZXhwaXJhdGlvbl9sZWRnZXIAAAAAAAAEAAAAAAAAAAE=", "AAAABQAAAAAAAAAAAAAACFRyYW5zZmVyAAAAAQAAAAh0cmFuc2ZlcgAAAAMAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAA==", "AAAABQAAAAAAAAAAAAAADVRyYW5zZmVyTXV4ZWQAAAAAAAABAAAACHRyYW5zZmVyAAAABAAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAAC3RvX211eGVkX2lkAAAAAAQAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAABEJ1cm4AAAABAAAABGJ1cm4AAAACAAAAAAAAAARmcm9tAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAA", "AAAABQAAAAAAAAAAAAAABE1pbnQAAAABAAAABG1pbnQAAAACAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAA", "AAAABQAAAAAAAAAAAAAACENsYXdiYWNrAAAAAQAAAAhjbGF3YmFjawAAAAIAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAA=", "AAAABQAAAAAAAAAAAAAACFNldEFkbWluAAAAAQAAAAlzZXRfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAAAAAAA=", "AAAABQAAAAAAAAAAAAAADVNldEF1dGhvcml6ZWQAAAAAAAABAAAADnNldF9hdXRob3JpemVkAAAAAAACAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAAAAAACWF1dGhvcml6ZQAAAAAAAAEAAAAAAAAAAA=="]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJson = {
    allowance : this.txFromJson<bigint>,  authorized : this.txFromJson<boolean>,  approve : this.txFromJson<void>,  balance : this.txFromJson<bigint>,  burn : this.txFromJson<void>,  burn_from : this.txFromJson<void>,  clawback : this.txFromJson<void>,  decimals : this.txFromJson<number>,  mint : this.txFromJson<void>,  name : this.txFromJson<string>,  set_admin : this.txFromJson<void>,  admin : this.txFromJson<string>,  set_authorized : this.txFromJson<void>,  symbol : this.txFromJson<string>,  transfer : this.txFromJson<void>,  transfer_from : this.txFromJson<void>
  };

  /** @deprecated Use fromJson instead. */
  public readonly fromJSON = this.fromJson;

  /**
   * Parse a raw contract event (topics + data) into a typed {@link ContractEvent}.
   */
  parseEvent(topics: xdr.ScVal[] | string[], data: xdr.ScVal | string): ContractEvent | undefined {
    return this.spec.parseEvent(topics, data) as ContractEvent | undefined;
  }
  /**
   * Build a topics filter row for the "Approve" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  approveEventFilter(topicValues?: { from?: string | Address; spender?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Approve", topicValues);
  }
  /**
   * Build a topics filter row for the "Transfer" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  transferEventFilter(topicValues?: { from?: string | Address; to?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Transfer", topicValues);
  }
  /**
   * Build a topics filter row for the "TransferMuxed" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  transferMuxedEventFilter(topicValues?: { from?: string | Address; to?: string | Address }): string[] {
    return this.spec.eventTopicFilter("TransferMuxed", topicValues);
  }
  /**
   * Build a topics filter row for the "Burn" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  burnEventFilter(topicValues?: { from?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Burn", topicValues);
  }
  /**
   * Build a topics filter row for the "Mint" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  mintEventFilter(topicValues?: { to?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Mint", topicValues);
  }
  /**
   * Build a topics filter row for the "Clawback" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  clawbackEventFilter(topicValues?: { from?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Clawback", topicValues);
  }
  /**
   * Build a topics filter row for the "SetAdmin" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  setAdminEventFilter(): string[] {
    return this.spec.eventTopicFilter("SetAdmin");
  }
  /**
   * Build a topics filter row for the "SetAuthorized" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  setAuthorizedEventFilter(topicValues?: { id?: string | Address }): string[] {
    return this.spec.eventTopicFilter("SetAuthorized", topicValues);
  }
}