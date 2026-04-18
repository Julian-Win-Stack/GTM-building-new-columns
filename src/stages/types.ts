export type StageCompany = {
  companyName: string;
  domain: string;
};

export type StageResultOk<T> = {
  company: StageCompany;
  data: T;
  error?: undefined;
};

export type StageResultError = {
  company: StageCompany;
  data?: undefined;
  error: string;
};

export type StageResult<T> = StageResultOk<T> | StageResultError;

export type GateRule<T> = (data: T) => boolean;
