export interface LaunchVrExperienceRequest {
  experienceId: 'narrative-engine-webui';
}

export type PreparedVrExperience =
  | { status: 'ready'; url: string }
  | { status: 'invalid' };