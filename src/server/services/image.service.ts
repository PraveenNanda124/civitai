import { ModelStatus, Prisma, ReportReason, ReportStatus } from '@prisma/client';
import { SessionUser } from 'next-auth';

import { env } from '~/env/server.mjs';
import { BrowsingMode, ImageSort } from '~/server/common/enums';
import { prisma } from '~/server/db/client';
import { GetByIdInput } from '~/server/schema/base.schema';
import { GetGalleryImageInput, GetImageConnectionsSchema } from '~/server/schema/image.schema';
import { imageGallerySelect, imageSelect } from '~/server/selectors/image.selector';
import { decreaseDate } from '~/utils/date-helpers';

export const getModelVersionImages = async ({ modelVersionId }: { modelVersionId: number }) => {
  const result = await prisma.imagesOnModels.findMany({
    where: { modelVersionId, image: { tosViolation: false } },
    select: { image: { select: imageSelect } },
  });
  return result.map((x) => x.image);
};

export const getReviewImages = async ({ reviewId }: { reviewId: number }) => {
  const result = await prisma.imagesOnReviews.findMany({
    where: { reviewId, image: { tosViolation: false } },
    select: { image: { select: imageSelect } },
  });
  return result.map((x) => x.image);
};

export const getGalleryImages = async <
  TOrderBy extends Prisma.Enumerable<Prisma.ImageOrderByWithRelationInput>
>({
  limit,
  cursor,
  modelId,
  modelVersionId,
  reviewId,
  userId,
  user,
  orderBy,
  infinite,
  period,
  sort,
  tags,
  excludedTagIds,
  excludedUserIds,
  isFeatured,
  types,
  browsingMode,
}: GetGalleryImageInput & { orderBy?: TOrderBy; user?: SessionUser }) => {
  const canViewNsfw = user?.showNsfw ?? env.UNAUTHENTICATED_LIST_NSFW;
  const isMod = user?.isModerator ?? false;

  const conditionalFilters: Prisma.Enumerable<Prisma.ImageWhereInput> = [];
  if (!!excludedTagIds?.length)
    conditionalFilters.push({ tags: { every: { tagId: { notIn: excludedTagIds } } } });

  if (!!tags?.length) conditionalFilters.push({ tags: { some: { tagId: { in: tags } } } });
  else {
    const periodStart = decreaseDate(new Date(), 3, 'days');
    conditionalFilters.push({ featuredAt: { gt: periodStart } });
  }

  if (isFeatured) conditionalFilters.push({ featuredAt: { not: null } });

  if (!!excludedUserIds?.length) conditionalFilters.push({ userId: { notIn: excludedUserIds } });

  if (types && types.length) conditionalFilters.push({ generationProcess: { in: types } });

  const infiniteWhere: Prisma.ImageFindManyArgs['where'] = {
    connections: {
      modelId,
      modelVersionId,
      reviewId,
    },
    OR: [
      {
        // Only include images from published models and without tosViolation
        imagesOnModels: {
          modelVersion: { model: { status: ModelStatus.Published, tosViolation: false } },
        },
      },
      {
        imagesOnReviews: { review: { tosViolation: false } },
      },
    ],
    AND: conditionalFilters.length ? conditionalFilters : undefined,
  };
  const finiteWhere: Prisma.ImageWhereInput = {
    imagesOnModels:
      modelVersionId || modelId
        ? { modelVersionId, modelVersion: modelId ? { modelId } : undefined }
        : undefined,
    imagesOnReviews: reviewId ? { reviewId } : undefined,
  };

  if (canViewNsfw && !browsingMode) browsingMode = BrowsingMode.All;
  else if (!canViewNsfw) browsingMode = BrowsingMode.SFW;

  const items = await prisma.image.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    take: limit,
    where: {
      userId,
      nsfw:
        browsingMode === BrowsingMode.All
          ? undefined
          : { equals: browsingMode === BrowsingMode.NSFW },
      tosViolation: !isMod ? false : undefined,
      ...(infinite ? infiniteWhere : finiteWhere),
    },
    select: imageGallerySelect({ user }),
    orderBy: orderBy ?? [
      ...(sort === ImageSort.MostComments
        ? [{ rank: { [`commentCount${period}Rank`]: 'asc' } }]
        : sort === ImageSort.MostReactions
        ? [{ rank: { [`reactionCount${period}Rank`]: 'asc' } }]
        : []),
      { createdAt: 'desc' },
    ],
  });

  return items.map(({ stats, ...image }) => ({
    ...image,
    metrics: {
      likeCount: stats?.likeCountAllTime,
      dislikeCount: stats?.dislikeCountAllTime,
      laughCount: stats?.laughCountAllTime,
      cryCount: stats?.cryCountAllTime,
      heartCount: stats?.heartCountAllTime,
      commentCount: stats?.commentCountAllTime,
    },
  }));
};

export const deleteImageById = ({ id }: GetByIdInput) => {
  return prisma.image.delete({ where: { id } });
};

export const updateImageById = <TSelect extends Prisma.ImageSelect>({
  id,
  select,
  data,
}: {
  id: number;
  data: Prisma.ImageUpdateArgs['data'];
  select: TSelect;
}) => {
  return prisma.image.update({ where: { id }, data, select });
};

export const updateImageReportStatusByReason = ({
  id,
  reason,
  status,
}: {
  id: number;
  reason: ReportReason;
  status: ReportStatus;
}) => {
  return prisma.report.updateMany({
    where: { reason, image: { imageId: id } },
    data: { status },
  });
};

export const getImageConnectionsById = ({ id, modelId, reviewId }: GetImageConnectionsSchema) => {
  return prisma.image.findUnique({
    where: { id },
    select: {
      connections: {
        select: {
          model: modelId
            ? {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  rank: {
                    select: {
                      downloadCountAllTime: true,
                      favoriteCountAllTime: true,
                      commentCountAllTime: true,
                      ratingCountAllTime: true,
                      ratingAllTime: true,
                    },
                  },
                },
              }
            : undefined,
          review: reviewId ? { select: { id: true } } : undefined,
        },
      },
    },
  });
};
