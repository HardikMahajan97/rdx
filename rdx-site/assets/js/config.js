// Everything on the site that someone might want to change, in one place.

export const SITE = {
  name: 'RDx',
  tagline: 'Badminton every morning and evening.',
  // Link to the RDx booking app (the badminton-community project once it is deployed), e.g. 'https://rdx-app.vercel.app'.
  // Leave empty to hide the "Open the app" buttons.
  appUrl: '',
  // Where you play. Leave empty to hide it.
  venue: '',
  mapUrl: '',
  joinMessage: "Hi! I'd like to join RDx badminton. My name is ",
};

export const SESSIONS = [
  { name: 'Morning', start: '7:00 AM', end: '8:00 AM' },
  { name: 'Evening', start: '7:00 PM', end: '8:00 PM' },
];

// Phone numbers as 10 digits (Indian mobile). Displayed as +91 xxxxx xxxxx.
export const TEAM = [
  { name: 'Rahul Dhekane', alias: 'RDx', role: 'Community head', phone: '8898117019' },
  { name: 'Sadanand Wagh', role: 'Core member', phone: '8793103747' },
  { name: 'Pranit Devre', role: 'Core member', phone: '9766990861' },
  { name: 'Jaideep Bisen', role: 'Core member', phone: '9325735543' },
];

export const KIND_LABELS = {
  announcement: 'Announcement',
  tournament: 'Tournament',
  video: 'Video',
  photos: 'Photos',
};
