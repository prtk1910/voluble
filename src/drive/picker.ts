import { api } from '../api/client';

type PickerData = { action: string; docs?: Array<{ id: string }> };
type PickerBuilder = { addView(view: unknown): PickerBuilder; setOAuthToken(token: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder; setAppId(id: string): PickerBuilder; setCallback(callback: (data: PickerData) => void): PickerBuilder; build(): { setVisible(value: boolean): void } };
declare global { interface Window { google?: { picker: { ViewId: { FOLDERS: string }; DocsView: new (id: string) => { setIncludeFolders(value: boolean): unknown; setSelectFolderEnabled(value: boolean): unknown }; PickerBuilder: new () => PickerBuilder } }; gapi?: { load(module: string, callback: () => void): void } } }

async function loadPicker(): Promise<void> {
  if (!window.gapi) await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://apis.google.com/js/api.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Google Picker could not load.')); document.head.append(script);
  });
  await new Promise<void>((resolve) => window.gapi!.load('picker', resolve));
}

export async function chooseDriveFolder(): Promise<string | undefined> {
  const credentials = await api.pickerToken();
  await loadPicker();
  return new Promise((resolve) => {
    const view = new window.google!.picker.DocsView(window.google!.picker.ViewId.FOLDERS);
    view.setIncludeFolders(true); view.setSelectFolderEnabled(true);
    const builder = new window.google!.picker.PickerBuilder().addView(view).setOAuthToken(credentials.accessToken).setDeveloperKey(credentials.apiKey).setCallback((data) => {
      if (data.action === 'picked') resolve(data.docs?.[0]?.id);
      if (data.action === 'cancel') resolve(undefined);
    });
    if (credentials.appId) builder.setAppId(credentials.appId);
    builder.build().setVisible(true);
  });
}
