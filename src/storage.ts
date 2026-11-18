import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { Memory, Message, Mode, Profile, Scene } from './core';

export type LocalState = {
  profiles: Profile[]; activeId: string | null;
  scene: Scene; mode: Mode; messages: Message[];
  memories: Memory[]; memoryEnabled: boolean;
};

export const initialState: LocalState = {
  profiles: [], activeId: null, scene: 'free', mode: 'balanced', messages: [], memories: [], memoryEnabled: true,
};

const stateKey = 'english-talk.local.v1';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function readState(): Promise<LocalState> {
  const saved = await AsyncStorage.getItem(stateKey);
  return saved ? { ...initialState, ...JSON.parse(saved) } : initialState;
}

export function writeState(state: LocalState) {
  return AsyncStorage.setItem(stateKey, JSON.stringify(state));
}

export async function writeCredential(id: string, key: string) {
  await SecureStore.setItemAsync(`key.${id}`, key, secureOptions);
}

export async function readCredential(id: string) {
  const key = await SecureStore.getItemAsync(`key.${id}`, secureOptions);
  if (!key) throw new Error('找不到此配置的 API Key，请在 API 设置中重新填写。');
  return key;
}

export function removeCredential(id: string) {
  return SecureStore.deleteItemAsync(`key.${id}`, secureOptions);
}
