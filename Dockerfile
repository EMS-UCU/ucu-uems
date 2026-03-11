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
# ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
# ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

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