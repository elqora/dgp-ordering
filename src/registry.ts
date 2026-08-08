// SPDX-License-Identifier: GPL-3.0-only

import type { ProductField } from "@elqora/dgp-spec";

import type { FieldBinding } from "./store.js";

export type InputCardinality = "scalar" | "single" | "multiple";

export interface InputDescriptor {
  type: string;
  variant?: string;
  cardinality: InputCardinality;
  options?: boolean;
  recursive_options?: boolean;
}

export interface InputRegistry {
  register(descriptor: InputDescriptor): void;
  resolve(type: string, variant?: string): InputDescriptor | undefined;
}

export function createInputRegistry(initial: readonly InputDescriptor[] = []): InputRegistry {
  const key = (type: string, variant: string): string => `${type}\u0000${variant}`;
  const descriptors = new Map(initial.map((descriptor) => [key(descriptor.type, descriptor.variant ?? "default"), descriptor]));
  return {
    register(descriptor) {
      descriptors.set(key(descriptor.type, descriptor.variant ?? "default"), descriptor);
    },
    resolve(type, variant = "default") {
      return descriptors.get(key(type, variant)) ?? descriptors.get(key(type, "default"));
    },
  };
}

export interface ComponentAdapter<Component> {
  create(field: ProductField, binding: FieldBinding, descriptor: InputDescriptor): Component;
}
