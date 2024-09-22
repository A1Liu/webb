import {
  ConnectionDriver,
  ConnectionDriverDefinition,
  ConnectionDriverInit,
  ConnectionRegisterInfo,
  NetworkContext,
  RawDatagram,
} from "@a1liu/webb-tools/network";

export class HttpDriver implements ConnectionDriver {
  static readonly id = "HttpDriver";

  constructor(fields: ConnectionDriverInit) {
    console.log("creating", fields);
  }

  registerConnection({
    peerDeviceId,
    additionalInfo,
  }: ConnectionRegisterInfo): Promise<{ success: boolean }> {
    console.log("registering ", peerDeviceId, additionalInfo);
    throw new Error("Method not implemented.");
  }
  sendDatagram(datagram: RawDatagram, ctx?: NetworkContext): Promise<void> {
    console.log("Sending ", datagram, ctx);
    throw new Error("Method not implemented.");
  }
  close(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

HttpDriver satisfies ConnectionDriverDefinition;
