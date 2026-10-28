// Everything on the site that someone might want to change, in one place.

export const SITE = {
  name: 'RDx',
  tagline: 'Badminton every morning and evening.',
  // Where the Log in buttons go (data-app): the booking app's Log in screen (same website).
  appUrl: '/?app=1',
  // Where the Register buttons go (data-app="register"): the app's own registration page.
  registerUrl: '/register',
  // Where you play. Leave empty to hide it. mapUrl: a Google Maps link to it (optional).
  venue: 'Aliens Badminton Academy',
  mapUrl: 'https://maps.app.goo.gl/nebRK6iLGiv4KU559',
  joinMessage: "Hi! I'd like to join RDx badminton. My name is ",
};

export const COMMUNITY = {
  members: '300+',
  // How many courts the academy has (drawn in the About section); each batch lights up its own.
  totalCourts: 6,
};

// courts: court numbers at the venue used by that batch.
export const SESSIONS = [
  { name: 'Morning', start: '7:00 AM', end: '8:00 AM', courts: [1, 2] },
  { name: 'Evening', start: '7:00 PM', end: '8:00 PM', courts: [4, 5, 6] },
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
