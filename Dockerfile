# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the source code
COPY . .

# If you prefer passing envs at build time, uncomment these lines and
# build with --build-arg (see step 3):
# ARG VITE_SUPABASE_URL
# ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=https://myrzpmkgqymgobfhlhey.supabase.co
ENV VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15cnpwbWtncXltZ29iZmhsaGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNTU2MDUsImV4cCI6MjA3ODYzMTYwNX0.2_IiJsfWDD8LSPjQnmyXyTSWvt-xufVvAWfjixuYEtU

# Build the production static files
RUN npm run build

# ---- Runtime stage: Nginx to serve static files ----
FROM nginx:1.27-alpine

# Remove default config and add our SPA-friendly config
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose HTTP port
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]