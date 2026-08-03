// SPDX-License-Identifier: GPL-3.0-only

import type { ProductField } from "@elqora/dgp-spec";

import type { FieldBinding } from "./store.js";

export type InputCardinality = "scalar" | "single" | "multiple";

export interface InputDescriptor {
  type: string;
  cardinality: InputCardinality;
}

export interface InputRegistry {
  register(descriptor: InputDescriptor): void;
  resolve(type: string): InputDescriptor | undefined;
}

export function createInputRegistry(initial: readonly InputDescriptor[] = []): InputRegistry {
  const descriptors = new Map(initial.map((descriptor) => [descriptor.type, descriptor]));
  return {
    register(descriptor) {
      descriptors.set(descriptor.type, descriptor);
    },
    resolve(type) {
      return descriptors.get(type);
    },
  };
}

export interface ComponentAdapter<Component> {
  create(field: ProductField, binding: FieldBinding, descriptor: InputDescriptor): Component;
}
