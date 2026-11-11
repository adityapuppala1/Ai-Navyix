import type{Metadata,Viewport}from'next';import './globals.css';
export const metadata:Metadata={title:'Navyix | Engineering confidence',description:'Evidence-backed design, build, test and release intelligence.'};
export const viewport:Viewport={width:'device-width',initialScale:1,colorScheme:'dark'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
