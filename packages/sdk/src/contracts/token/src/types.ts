import {Address} from '@stellar/stellar-sdk';

    /**
 * Event: Approve
 */
export interface ApproveEvent {
  name: "Approve";
  data: {
    from: string;
    spender: string;
    amount: bigint;
    expiration_ledger: number;
  };
}

/**
 * Event: Transfer
 */
export interface TransferEvent {
  name: "Transfer";
  data: {
    from: string;
    to: string;
    amount: bigint;
  };
}

/**
 * Event: TransferMuxed
 */
export interface TransferMuxedEvent {
  name: "TransferMuxed";
  data: {
    from: string;
    to: string;
    to_muxed_id?: number;
    amount?: bigint;
  };
}

/**
 * Event: Burn
 */
export interface BurnEvent {
  name: "Burn";
  data: {
    from: string;
    amount: bigint;
  };
}

/**
 * Event: Mint
 */
export interface MintEvent {
  name: "Mint";
  data: {
    to: string;
    amount: bigint;
  };
}

/**
 * Event: Clawback
 */
export interface ClawbackEvent {
  name: "Clawback";
  data: {
    from: string;
    amount: bigint;
  };
}

/**
 * Event: SetAdmin
 */
export interface SetAdminEvent {
  name: "SetAdmin";
  data: {
    new_admin: string;
  };
}

/**
 * Event: SetAuthorized
 */
export interface SetAuthorizedEvent {
  name: "SetAuthorized";
  data: {
    id: string;
    authorize: boolean;
  };
}
    export type ContractEvent = ApproveEvent | TransferEvent | TransferMuxedEvent | BurnEvent | MintEvent | ClawbackEvent | SetAdminEvent | SetAuthorizedEvent;
    